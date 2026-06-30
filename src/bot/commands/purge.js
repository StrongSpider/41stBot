'use strict'

const { SlashCommandBuilder, AttachmentBuilder, PermissionsBitField, MessageFlags } = require('discord.js')

const quota = require('../../api/quota.js')
const config = require('../../../config.json')
const database = require('../../api/database')
const roblox = require('../../api/roblox.js')

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('Purge', 'BOT')

/** Sleep helper to rate limit role ops */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Map a freeform company label to a short canonical name
 * @param {string} label
 * @returns {('Trooper'|'Green'|'Sarlacc'|'Ranger'|'Zeus'|'ARC'|null)}
 */
function shortCompany(label) {
    if (!label) return null
    const s = String(label).toLowerCase()
    if (s.includes('trooper')) return 'Trooper'
    if (s.includes('green')) return 'Green'
    if (s.includes('sarlacc')) return 'Sarlacc'
    if (s.includes('ranger')) return 'Ranger'
    if (s.includes('zeus')) return 'Zeus'
    if (s.includes('advanced recon commandos')) return 'ARC'
    return null
}

/**
 * Build a roleId -> short company name map from config.DISCORD.ROLES.COMPANY
 */
function buildCompanyRoleMap() {
    const map = {}
    const src = config.DISCORD.ROLES.COMPANY || {}
    for (const [roleId, label] of Object.entries(src)) {
        const k = shortCompany(label)
        if (k) map[roleId] = k
    }
    return map
}

/**
 * Find the first company for a guild member based on their roles
 * @param {import('discord.js').GuildMember} member
 * @param {Record<string,string>} companyRoleMap
 */
function firstCompanyFor(member, companyRoleMap) {
    for (const role of member.roles.cache.values()) {
        if (companyRoleMap[role.id]) return companyRoleMap[role.id]
    }
    return null
}

/**
 * Construct the managegroup rank command to set a user to Trooper
 * @param {string} groupName
 * @param {string} username
 * @param {string} newRank
 * @param {string} reason
 */
function managegroupRankCmd(groupName, username, newRank, reason) {
    return `/managegroup rank group: ${groupName} roblox_user: ${username} new_rank: ${newRank} reason: ${reason}`
}

/**
 * Construct the managegroup kick slash command
 * @param {string} groupName
 * @param {string} username
 * @param {string} reason
 */
function managegroupKickCmd(groupName, username, reason) {
    return `/managegroup kick group: ${groupName} roblox_user: ${username} reason: ${reason}`
}

function errToObj(e) {
    if (!e) return { message: 'unknown' }
    return {
        name: e.name,
        message: e.message || String(e),
        code: e.code,
        stack: e.stack
    }
}

async function safeSend(channel, contentOrPayload, label, runId) {
    try {
        return await channel.send(contentOrPayload)
    } catch (e) {
        logger.error(`[SEND_FAIL] runId=${runId} label=${label} ${JSON.stringify(errToObj(e))}`)
        return null
    }
}

async function safeEditReply(interaction, payload, label, runId) {
    try {
        return await interaction.editReply(payload)
    } catch (e) {
        logger.error(`[EDIT_REPLY_FAIL] runId=${runId} label=${label} ${JSON.stringify(errToObj(e))}`)
        return null
    }
}

async function safeFollowUp(interaction, payload, label, runId) {
    try {
        return await interaction.followUp(payload)
    } catch (e) {
        logger.error(`[FOLLOWUP_FAIL] runId=${runId} label=${label} ${JSON.stringify(errToObj(e))}`)
        return null
    }
}

async function safeAwaitMessages(channel, options, label, runId) {
    try {
        return await channel.awaitMessages(options)
    } catch (e) {
        logger.error(`[AWAIT_MESSAGES_FAIL] runId=${runId} label=${label} ${JSON.stringify(errToObj(e))}`)
        return null
    }
}

async function guard(label, fn, fallback, runId) {
    try {
        return await fn()
    } catch (e) {
        logger.error(`[GUARD_FAIL] runId=${runId} label=${label} ${JSON.stringify(errToObj(e))}`)
        return fallback
    }
}

async function retry(fn, { tries = 3, baseDelay = 750, label = 'op', runId = 'na' } = {}) {
    let lastErr
    for (let i = 1; i <= tries; i++) {
        try {
            return await fn()
        } catch (e) {
            lastErr = e
            logger.warn(`[RETRY] runId=${runId} label=${label} attempt=${i}/${tries} err=${e?.message || String(e)}`)
            if (i < tries) await sleep(baseDelay * Math.pow(2, i - 1))
        }
    }
    throw lastErr
}

async function fetchRobloxUsernameForPurge(robloxId, memberId, runId) {
    try {
        return await roblox.getUsernameFromId(robloxId)
    } catch (e) {
        const err = errToObj(e)
        const message = String(err.message || '').toLowerCase()
        const label = `roblox.getUsernameFromId robloxId=${robloxId} memberId=${memberId}`

        if (message.includes('user not found')) {
            logger.warn(`[ROBLOX_LOOKUP_MISS] runId=${runId} label=${label} ${JSON.stringify(err)}`)
        } else {
            logger.error(`[ROBLOX_LOOKUP_FAIL] runId=${runId} label=${label} ${JSON.stringify(err)}`)
        }

        return null
    }
}

function discordFallbackNameFor(member) {
    const candidates = [
        { source: 'Discord nickname', value: member.nickname },
        { source: 'Discord display name', value: member.user.displayName },
        { source: 'Discord username', value: member.user.username }
    ]
    const picked = candidates.find(candidate => candidate.value)
    const rawName = picked?.value || 'Unknown'
    const name = String(rawName).replace(/\[IN\]/g, '').replace(/\s+/g, '')

    return {
        name: name || 'Unknown',
        source: picked?.source || 'Discord username'
    }
}

function msToHuman(ms) {
    const s = Math.ceil(ms / 1000)
    const m = Math.floor(s / 60)
    const r = s % 60
    if (m <= 0) return `${s}s`
    if (r === 0) return `${m}m`
    return `${m}m ${r}s`
}

/**
 * Wait for the invoker to either skip or send any message to continue.
 * Returns { skipped: true } or { confirmed: true }.
 * Hard guarantee: never hangs forever (timeout).
 * Also: timeouts are clearly messaged to the user.
 *
 * @param {import('discord.js').TextChannel} channel
 * @param {{
 *   invokerId:string,
 *   prompt?:string,
 *   runId:string,
 *   timeoutMs?:number,
 *   contextLabel?:string
 * }} opts
 */
async function waitForUserProceed(channel, {
    invokerId,
    prompt,
    runId,
    timeoutMs = 300000,
    contextLabel = 'action'
}) {
    if (prompt) await safeSend(channel, prompt, 'wait.prompt', runId)

    const filter = m => m.author.id === invokerId
    const collected = await safeAwaitMessages(channel, { filter, max: 1, time: timeoutMs }, 'wait.user_proceed', runId)
    const msg = collected?.first()

    if (!msg) {
        logger.warn(`[WAIT_TIMEOUT] runId=${runId} label=${contextLabel} timeoutMs=${timeoutMs}`)
        await safeSend(
            channel,
            `Timed out after ${msToHuman(timeoutMs)} waiting for your confirmation message for this ${contextLabel}.\nSend any message to continue, or type \`skip\` to skip.`,
            'wait.user_proceed.timeout_notice',
            runId
        )
        return { skipped: true, reason: 'timeout', timeoutMs }
    }

    if ((msg.content || '').trim().toLowerCase() === 'skip') return { skipped: true, reason: 'user_skip' }
    return { confirmed: true }
}

module.exports = {
    permission: 'FFCNC',
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Run the weekly purge')
        .addBooleanOption(o => o
            .setName('test')
            .setDescription('Run the purge without changing any Discord roles')
            .setRequired(false)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const runId = `${Date.now()}-${interaction.user?.id || 'unknown'}`
        const t0 = Date.now()
        const TEST_MODE = Boolean(interaction.options?.getBoolean('test'))

        logger.info(`[PURGE_START] runId=${runId} guildId=${interaction.guild?.id} channelId=${interaction.channel?.id} userId=${interaction.user?.id} testMode=${TEST_MODE}`)

        try {
            await interaction.deferReply()

            await database.setEventEpLock(true)
            logger.info(`[EVENT_EP_LOCK] runId=${runId} enabled=true`)

            const guild = interaction.guild
            if (!guild) {
                logger.warn(`[PURGE_ABORT] runId=${runId} reason=no_guild`)
                await safeEditReply(interaction, { content: 'This can only be used in a guild.', flags: MessageFlags.Ephemeral }, 'no_guild', runId)
                return
            }

            const GROUP_NAME = config.GENERAL.GROUP_NAME || '41st'
            const TROOPER_COMMAND_RANK = config.GENERAL.TROOPER_RANK_COMMAND || 'Trooper'
            const DEMOTION_REASON = config.GENERAL.PURGE_DEMOTION_REASON || 'Failed quota'
            const KICK_REASON = config.GENERAL.PURGE_KICK_REASON || 'Failed quota'
            const EXEMPT_ROLE_IDS = [config.DISCORD.ROLES.EXEMPT].filter(Boolean)
            const PURGE_DEFCON_ROLE_ID = config.DISCORD.ROLES.PURGE_DEFCON
            const RECRUIT_ROLE_ID = config.DISCORD.ROLES.RECRUIT
            const BYPASS_USER_IDS = Array.isArray(config.GENERAL.BYPASS_USER_IDS) ? config.GENERAL.BYPASS_USER_IDS : []
            const SL_PLUS_ROLE_IDS = config.DISCORD.ROLES.RANK ? Object.keys(config.DISCORD.ROLES.RANK).filter(id => id !== '704881591272472596') : []

            const UNIT_ROLES = []
            if (Array.isArray(config.DISCORD.ROLES.UNIT)) {
                for (const unit of config.DISCORD.ROLES.UNIT) {
                    if (Array.isArray(unit.roles)) for (const role of unit.roles) UNIT_ROLES.push(role)
                }
            }

            const companyRoleMap = buildCompanyRoleMap()

            logger.info(`[STAGE] runId=${runId} config_loaded group=${GROUP_NAME} purgeDefcon=${Boolean(PURGE_DEFCON_ROLE_ID)} exemptCount=${EXEMPT_ROLE_IDS.length} unitRoleCount=${UNIT_ROLES.length} testMode=${TEST_MODE}`)

            await safeEditReply(
                interaction,
                { content: `This command is interactive and cannot be undone.${TEST_MODE ? "\n\nTEST MODE is enabled: no Discord roles will be added/removed." : ""}\nType \`confirm\` to continue within 60s, or anything else to cancel.` },
                'prompt_confirm',
                runId
            )

            logger.info(`[STAGE] runId=${runId} confirm_wait_start timeout=60s`)

            const conf = await safeAwaitMessages(
                interaction.channel,
                { filter: m => m.author.id === interaction.user.id, max: 1, time: 60000 },
                'confirm_wait',
                runId
            )
            const reply = conf?.first()

            if (!reply || reply.content.trim().toLowerCase() !== 'confirm') {
                logger.info(`[PURGE_CANCELLED] runId=${runId}`)
                await safeFollowUp(interaction, 'Cancelled.', 'cancelled_followup', runId)
                return
            }

            logger.info(`[STAGE] runId=${runId} confirm_ok scan_begin`)
            await safeFollowUp(interaction, 'Beginning purge scan...', 'scan_begin_followup', runId)

            logger.info(`[STAGE] runId=${runId} guild_members_fetch_start`)
            const fetchOk = await guard('guild.members.fetch', () => guild.members.fetch(), null, runId)
            logger.info(`[STAGE] runId=${runId} guild_members_fetch_done cached=${guild.members.cache.size} ok=${Boolean(fetchOk)}`)

            const failedByCompany = { Trooper: [], Green: [], Sarlacc: [], Ranger: [], Zeus: [], ARC: [] }
            const demotionList = []
            const kickList = []
            const skippedMemberIds = new Set()
            const completedDemotions = []
            const completedKicks = []
            const passedCount = { total: 0, purgeCleared: 0 }
            const failedCount = { total: 0 }
            let quotaFailCount = 0
            let robloxLookupFailCount = 0
            let purgeRoleAddFailCount = 0
            let purgeRoleRemoveFailCount = 0

            logger.info(`[STAGE] runId=${runId} scan_members_start total=${guild.members.cache.size}`)

            let i = 0
            for (const member of guild.members.cache.values()) {
                i += 1
                if (member.user.bot) continue

                const fallbackName = discordFallbackNameFor(member)
                let name = fallbackName.name

                const robloxId = await guard(`db.getRobloxIdByDiscord memberId=${member.id}`, () => database.getRobloxIdByDiscord(member.user.id), null, runId)

                if (robloxId) {
                    const fetchedName = await fetchRobloxUsernameForPurge(robloxId, member.id, runId)
                    if (fetchedName) name = fetchedName
                    else {
                        robloxLookupFailCount += 1
                        await safeSend(
                            interaction.channel,
                            `Roblox username lookup failed for <@${member.id}> (Roblox ID \`${robloxId}\`). Using ${fallbackName.source} \`${fallbackName.name}\` for purge prompts.`,
                            'roblox_lookup_fallback_notice',
                            runId
                        )
                    }
                }

                const roles = member.roles.cache.map(r => r.id)
                if (member.permissions.has(PermissionsBitField.Flags.Administrator)) roles.push('admin')

                const report = await guard(
                    `quota.checkQuota memberId=${member.id} username=${name}`,
                    () => retry(() => quota.checkQuota({ id: member.id, username: name, roles }), { tries: 2, baseDelay: 750, label: `quota.checkQuota(${member.id})`, runId }),
                    null,
                    runId
                )

                if (!report) {
                    quotaFailCount += 1
                    await safeSend(interaction.channel, `Quota check failed for <@${member.id}>. Skipping.`, 'quota_failed_notice', runId)
                    continue
                }

                const company = firstCompanyFor(member, companyRoleMap)
                const onPurge = report?.purge
                const hasExemptRole = EXEMPT_ROLE_IDS.some(rid => member.roles.cache.has(rid))
                const isBypassUser = BYPASS_USER_IDS.includes(member.id) || BYPASS_USER_IDS.includes(member.user.id)
                const isExemptForPurge = report.status === 'EXEMPT' || hasExemptRole || isBypassUser
                const isRecruit = Boolean(RECRUIT_ROLE_ID && member.roles.cache.has(RECRUIT_ROLE_ID))

                if (isRecruit && !isExemptForPurge) {
                    kickList.push({
                        memberId: member.id,
                        member,
                        robloxName: report.username || name,
                        onPurge,
                        company: 'Recruit',
                        purge: onPurge,
                        quotas: report.quotas || [],
                        status: 'RECRUIT_PURGE'
                    })
                    continue
                }

                if (report.metPurgeQuotas) {
                    passedCount.total += 1
                    if (onPurge && PURGE_DEFCON_ROLE_ID) {
                        if (TEST_MODE) {
                            logger.info(`[TEST_MODE] runId=${runId} would_remove_role purgeDefcon memberId=${member.id}`)
                        } else {
                            const removed = await guard(
                                `roles.remove purgeDefcon memberId=${member.id}`,
                                () => member.roles.remove(PURGE_DEFCON_ROLE_ID, 'Passed quota: clearing purge defcon'),
                                null,
                                runId
                            )
                            if (removed) passedCount.purgeCleared += 1
                            else purgeRoleRemoveFailCount += 1
                        }
                    }
                    continue
                }

                if (report.status === 'EXEMPT') continue

                failedCount.total += 1

                const entry = {
                    memberId: member.id,
                    member,
                    robloxName: report.username || name,
                    onPurge,
                    company: company || 'Unassigned',
                    purge: onPurge,
                    quotas: report.quotas || [],
                    status: report.status || 'FAILED'
                }

                if (company && failedByCompany[company]) failedByCompany[company].push(entry)

                if (onPurge) {
                    if (company === 'Trooper') kickList.push(entry)
                    else demotionList.push(entry)
                } else if (PURGE_DEFCON_ROLE_ID) {
                    if (TEST_MODE) {
                        logger.info(`[TEST_MODE] runId=${runId} would_add_role purgeDefcon memberId=${member.id}`)
                    } else {
                        const added = await guard(`roles.add purgeDefcon memberId=${member.id}`, () => member.roles.add(PURGE_DEFCON_ROLE_ID, 'Failed quota'), null, runId)
                        if (!added) purgeRoleAddFailCount += 1
                    }
                }

                if (i % 50 === 0) logger.info(`[PROGRESS] runId=${runId} scan_members ${i}/${guild.members.cache.size} failed=${failedCount.total} passed=${passedCount.total}`)
            }

            logger.info(`[STAGE] runId=${runId} scan_members_done passed=${passedCount.total} failed=${failedCount.total} purgeCleared=${passedCount.purgeCleared} demotions=${demotionList.length} kicks=${kickList.length} quotaFail=${quotaFailCount} robloxLookupFail=${robloxLookupFailCount} purgeAddFail=${purgeRoleAddFailCount} purgeRemoveFail=${purgeRoleRemoveFailCount}`)

            await safeSend(
                interaction.channel,
                `Scan complete.\nFailed: ${failedCount.total}\nPassed: ${passedCount.total}\n\nPurge roles removed from passers: ${passedCount.purgeCleared}${TEST_MODE ? ' (TEST MODE: not applied)' : ''}\nExempt roles will be stripped after confirmations; users marked \`skip\` keep their roles.${TEST_MODE ? ' (TEST MODE: not applied)' : ''}\n\n**Quota check failures: ${quotaFailCount}**${TEST_MODE ? '\nTEST MODE: No Discord roles were changed.' : ''}`,
                'scan_summary',
                runId
            )

            logger.info(`[STAGE] runId=${runId} demotions_start count=${demotionList.length}`)

            if (demotionList.length) {
                await safeSend(
                    interaction.channel,
                    `${TEST_MODE ? 'TEST MODE: No Discord roles will be changed and no confirmations will be awaited.\n\n' : ''}# Starting demotions for ${demotionList.length} users.\nFor each user:\n- Run the slash command shown below.\n- Send any message in this channel to move to the next user.\n- Type \`skip\` to skip that user.\n\nTimeout: 5 minutes per user.`,
                    'demotions_intro',
                    runId
                )
            }

            let dIdx = 0
            for (const d of demotionList) {
                dIdx += 1

                const isSL = SL_PLUS_ROLE_IDS.length ? d.member.roles.cache.some(r => SL_PLUS_ROLE_IDS.includes(r.id)) : false
                const cmd = managegroupRankCmd(GROUP_NAME, d.robloxName, TROOPER_COMMAND_RANK, DEMOTION_REASON)
                const preface = `<@${d.memberId}> Demote **${d.robloxName}** [${d.company}] ${isSL ? '- <:warning:1297618648810393630> Heads up: SL+' : ''}.\nRun this slash command, then send anything in this channel to continue. Type \`skip\` to skip:`
                const block = '```' + cmd + '```'

                await safeSend(interaction.channel, `${preface}\n${block}`, `demotion_prompt_${dIdx}`, runId)

                if (TEST_MODE) {
                    logger.info(`[TEST_MODE] runId=${runId} would_demote memberId=${d.memberId} roblox=${d.robloxName} company=${d.company}`)
                    await safeSend(interaction.channel, `TEST MODE: would demote **${d.robloxName}**. Skipping confirmation wait.`, `demotion_testmode_${dIdx}`, runId)
                    continue
                }

                const res = await waitForUserProceed(interaction.channel, {
                    invokerId: interaction.user.id,
                    runId,
                    timeoutMs: 300000,
                    contextLabel: `demotion for ${d.robloxName}`
                })

                if (res.skipped) {
                    skippedMemberIds.add(d.memberId)
                    await safeSend(interaction.channel, `Skipped ${d.robloxName}.`, `demotion_skipped_${dIdx}`, runId)
                    continue
                }

                await safeSend(interaction.channel, `Received confirmation for **${d.robloxName}**. Moving to the next user.`, `demotion_confirmed_${dIdx}`, runId)
                completedDemotions.push(d)

                if (UNIT_ROLES.length) {
                    const toRemove = d.member.roles.cache.filter(r => UNIT_ROLES.includes(r.id)).map(r => r.id)
                    let removedCount = 0
                    for (const rid of toRemove) {
                        const removed = await guard(`roles.remove unitRole memberId=${d.memberId} roleId=${rid}`, () => d.member.roles.remove(rid, 'Demotion: removing company role'), null, runId)
                        if (removed) removedCount += 1
                        await sleep(50)
                    }
                    if (removedCount) await safeSend(interaction.channel, `Removed ${removedCount} company role(s) from <@${d.memberId}> after demotion.`, `demotion_roles_removed_${dIdx}`, runId)
                }
            }

            logger.info(`[STAGE] runId=${runId} demotions_done count=${demotionList.length}`)

            logger.info(`[STAGE] runId=${runId} kicks_start count=${kickList.length}`)

            if (kickList.length) {
                await safeSend(
                    interaction.channel,
                    `${TEST_MODE ? 'TEST MODE: No Discord roles will be changed and no confirmations will be awaited.\n\n' : ''}# Starting kicks for ${kickList.length} users.\nFor each user:\n- Run the slash command shown below.\n- Send any message in this channel to move to the next user.\n- Type \`skip\` to skip that user.\n\nTimeout: 5 minutes per user.`,
                    'kicks_intro',
                    runId
                )
            }

            let kIdx = 0
            for (const k of kickList) {
                kIdx += 1

                const isSL = SL_PLUS_ROLE_IDS.length ? k.member.roles.cache.some(r => SL_PLUS_ROLE_IDS.includes(r.id)) : false
                const cmd = managegroupKickCmd(GROUP_NAME, k.robloxName, KICK_REASON)
                const preface = `<@${k.memberId}> Kick **${k.robloxName}** [${k.company || 'Trooper'}]${isSL ? ' - <:warning:1297618648810393630> Heads up: SL+' : ''}.\nRun this slash command and also kick them from Discord, then send anything in this channel to continue. Type \`skip\` to skip:`
                const block = '```' + cmd + '```'

                await safeSend(interaction.channel, `${preface}\n${block}`, `kick_prompt_${kIdx}`, runId)

                if (TEST_MODE) {
                    logger.info(`[TEST_MODE] runId=${runId} would_kick memberId=${k.memberId} roblox=${k.robloxName}`)
                    await safeSend(interaction.channel, `TEST MODE: would kick **${k.robloxName}**. Skipping confirmation wait.`, `kick_testmode_${kIdx}`, runId)
                    continue
                }

                const res = await waitForUserProceed(interaction.channel, {
                    invokerId: interaction.user.id,
                    runId,
                    timeoutMs: 300000,
                    contextLabel: `kick for ${k.robloxName}`
                })

                if (res.skipped) {
                    skippedMemberIds.add(k.memberId)
                    await safeSend(interaction.channel, `Skipped ${k.robloxName}.`, `kick_skipped_${kIdx}`, runId)
                    continue
                }

                await safeSend(interaction.channel, `Received confirmation for **${k.robloxName}**. Moving to the next user.`, `kick_confirmed_${kIdx}`, runId)
                completedKicks.push(k)
            }

            logger.info(`[STAGE] runId=${runId} kicks_done count=${kickList.length}`)

            logger.info(`[STAGE] runId=${runId} strip_exempt_start roles=${EXEMPT_ROLE_IDS.length} testMode=${TEST_MODE} skipped=${skippedMemberIds.size}`)

            let exemptStripped = 0
            if (TEST_MODE) {
                logger.info(`[TEST_MODE] runId=${runId} would_strip_exempt_roles count=${EXEMPT_ROLE_IDS.length} skipped=${skippedMemberIds.size}`)
            } else if (EXEMPT_ROLE_IDS.length) {
                for (const member of guild.members.cache.values()) {
                    if (member.user.bot) continue
                    if (skippedMemberIds.has(member.id)) continue
                    const toRemove = EXEMPT_ROLE_IDS.filter(rid => member.roles.cache.has(rid))
                    for (const rid of toRemove) {
                        const removed = await guard(`roles.remove exempt memberId=${member.id} roleId=${rid}`, () => member.roles.remove(rid, 'Purge: removing exempt role (post-confirmation)'), null, runId)
                        if (removed) exemptStripped += 1
                        await sleep(50)
                    }
                }
            }

            logger.info(`[STAGE] runId=${runId} strip_exempt_done stripped=${exemptStripped}`)
            await safeSend(
                interaction.channel,
                `Exempt roles stripped: ${exemptStripped}${TEST_MODE ? ' (TEST MODE: not applied)' : ''}${skippedMemberIds.size ? `\nSkipped users who kept roles: ${skippedMemberIds.size}` : ''}`,
                'strip_exempt_summary',
                runId
            )

            logger.info(`[STAGE] runId=${runId} reports_build_start`)

            const attachments = []
            const now = new Date().toISOString().slice(0, 10)
            const reportDemotions = TEST_MODE ? demotionList : completedDemotions
            const reportKicks = TEST_MODE ? kickList : completedKicks

            for (const c of ['Trooper', 'Green', 'Sarlacc', 'Ranger', 'Zeus', 'ARC']) {
                const failed = failedByCompany[c]
                if (!failed || failed.length === 0) continue

                const demotedNames = reportDemotions.filter(x => x.company === c).map(x => `- ${x.robloxName} <@${x.memberId}>`)
                const kickedNames = c === 'Trooper' ? reportKicks.map(x => `- ${x.robloxName} <@${x.memberId}>`) : []

                let text = `# ${c} - Purge Report (${now})\n\n`
                text += `## Failed Quota (${failed.length})\n`
                for (const f of failed) {
                    text += `- ${f.robloxName} <@${f.memberId}>${f.onPurge ? ' [Purge Defcon]' : ''}\n`
                }
                text += `\n## Demoted (${demotedNames.length})\n` + (demotedNames.length ? demotedNames.join('\n') + '\n' : 'None\n')
                if (c === 'Trooper') text += `\n## Kicked (${kickedNames.length})\n` + (kickedNames.length ? kickedNames.join('\n') + '\n' : 'None\n')

                const fileName = `${c.replace(/\s+/g, '_').toLowerCase()}_purge_${now}.txt`
                attachments.push(new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: fileName }))
            }

            if (attachments.length) await safeSend(interaction.channel, { content: 'Company reports:', files: attachments }, 'reports_send', runId)
            else await safeSend(interaction.channel, 'No company failures to report.', 'reports_none', runId)

            try {
                const ids = Object.keys(config.DISCORD.ROLES.COMPANY || {})
                logger.info(`[DEBUG] runId=${runId} COMPANY_DISCORD_ROLES IDs: ${ids.join(', ')}`)
            } catch (e) {
                logger.warn(`[DEBUG] runId=${runId} dump_company_role_ids_failed ${JSON.stringify(errToObj(e))}`)
            }

            logger.info(`[PURGE_DONE] runId=${runId} ms=${Date.now() - t0}`)
        } catch (err) {
            logger.error(`[PURGE_FATAL] runId=${runId} ${JSON.stringify(errToObj(err))}`)

            const safeMsg = `Purge failed (run ${runId})`
            if (interaction.deferred || interaction.replied) await safeEditReply(interaction, { content: safeMsg }, 'fatal_editReply', runId)
            else {
                try {
                    await interaction.reply({ content: safeMsg, flags: MessageFlags.Ephemeral })
                } catch (e) {
                    logger.error(`[FATAL_REPLY_FAIL] runId=${runId} ${JSON.stringify(errToObj(e))}`)
                }
            }
        }
    }
}
