'use strict'

const { SlashCommandBuilder, AttachmentBuilder, PermissionsBitField, MessageFlags } = require('discord.js')

const quota = require('../../api/quota.js')
const config = require('../../../config.json')
const database = require('../../api/database.js')
const roblox = require('../../api/roblox.js')

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('Purge', 'BOT')

/** Sleep helper to rate limit role ops */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Map a freeform company label to a short canonical name
 * @param {string} label
 * @returns {('Trooper'|'Green'|'Sarlacc'|'Ranger'|'Zeus'|null)}
 */
function shortCompany(label) {
    if (!label) return null
    const s = String(label).toLowerCase()
    if (s.includes('trooper')) return 'Trooper'
    if (s.includes('green')) return 'Green'
    if (s.includes('sarlacc')) return 'Sarlacc'
    if (s.includes('ranger')) return 'Ranger'
    if (s.includes('zeus')) return 'Zeus'
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
 */
function managegroupRankCmd(groupName, username) {
    return `;managegroup ${groupName} rank ${username} trooper`
}

/**
 * Build a matcher that returns true when a GAR bot embed confirms a rank set to Trooper
 * @param {string} groupName
 * @param {string} robloxName
 */
function garSetTrooperMatcher(groupName, robloxName) {
    return m => {
        const d = m?.embeds?.[0]?.data?.description
        if (!d || typeof d !== 'string') return false
        const hasSet = d.startsWith('Set ')
        const hasTrooper = d.includes('`Trooper (10)`')
        const hasGroup = d.includes(`**${groupName}** group`)
        const hasName = d.toLowerCase().includes(`[${String(robloxName).toLowerCase()} `)
        return hasSet && hasTrooper && hasGroup && hasName
    }
}

/**
 * Build a matcher that returns true when a GAR bot embed confirms a kick
 * @param {string} groupName
 * @param {string} robloxName
 */
function garKickedMatcher(groupName, robloxName) {
    return m => {
        const d = m?.embeds?.[0]?.data?.description
        if (!d || typeof d !== 'string') return false
        const hasKicked = d.startsWith('Kicked ')
        const hasGroup = d.includes(`**${groupName}** group`)
        const hasName = d.toLowerCase().includes(`[${String(robloxName).toLowerCase()} `)
        return hasKicked && hasGroup && hasName
    }
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

function msToHuman(ms) {
    const s = Math.ceil(ms / 1000)
    const m = Math.floor(s / 60)
    const r = s % 60
    if (m <= 0) return `${s}s`
    if (r === 0) return `${m}m`
    return `${m}m ${r}s`
}

/**
 * Wait for either the invoker to issue a command/skip, or for a matching GAR embed
 * Returns { skipped: true } or { confirmed: true }
 * Hard guarantee: never hangs forever (both phases have timeouts).
 * Also: timeouts are clearly messaged to the user.
 *
 * @param {import('discord.js').TextChannel} channel
 * @param {{
 *   invokerId:string,
 *   needCmd:boolean,
 *   cmdExact:string,
 *   garBotId?:string|null,
 *   embedMatch:(m:any)=>boolean,
 *   prompt?:string,
 *   runId:string,
 *   phase1TimeoutMs?:number,
 *   phase2TimeoutMs?:number,
 *   contextLabel?:string
 * }} opts
 */
async function waitForUserOrEmbed(channel, {
    invokerId,
    needCmd,
    cmdExact,
    garBotId,
    embedMatch,
    prompt,
    runId,
    phase1TimeoutMs = 300000,
    phase2TimeoutMs = 300000,
    contextLabel = 'action'
}) {
    if (prompt) await safeSend(channel, prompt, 'wait.prompt', runId)

    if (needCmd) {
        const filter1 = m => m.author.id === invokerId && (
            m.content.trim().toLowerCase() === 'skip' ||
            m.content.trim() === cmdExact ||
            m.content.trim() === cmdExact + '/'
        )

        const c1 = await safeAwaitMessages(channel, { filter: filter1, max: 1, time: phase1TimeoutMs }, 'wait.phase1', runId)
        const m1 = c1?.first()
        if (!m1) {
            logger.warn(`[WAIT_TIMEOUT] runId=${runId} phase=1 label=${contextLabel} cmd=${cmdExact} timeoutMs=${phase1TimeoutMs}`)
            await safeSend(
                channel,
                `Timed out after ${msToHuman(phase1TimeoutMs)} waiting for you to post the command for this ${contextLabel}.\nType \`skip\` to move on, or re-run the command and continue.`,
                'wait.phase1.timeout_notice',
                runId
            )
            return { skipped: true, reason: 'phase1_timeout', timeoutMs: phase1TimeoutMs }
        }
        if (m1.content.trim().toLowerCase() === 'skip') return { skipped: true, reason: 'user_skip' }
    }

    const filter2 = m => {
        if (m.author.id === invokerId && m.content.trim().toLowerCase() === 'skip') return true
        if (garBotId && m.author.id !== garBotId) return false
        if (!garBotId && !m.author.bot) return false
        return embedMatch(m)
    }

    const c2 = await safeAwaitMessages(channel, { filter: filter2, max: 1, time: phase2TimeoutMs }, 'wait.phase2', runId)
    const m2 = c2?.first()

    if (!m2) {
        logger.warn(`[WAIT_TIMEOUT] runId=${runId} phase=2 label=${contextLabel} cmd=${cmdExact} timeoutMs=${phase2TimeoutMs}`)
        await safeSend(
            channel,
            `Timed out after ${msToHuman(phase2TimeoutMs)} waiting for the confirmation embed for this ${contextLabel}.\nIf GAR Bot is slow or down, you can type \`skip\` to move on.`,
            'wait.phase2.timeout_notice',
            runId
        )
        return { skipped: true, reason: 'phase2_timeout', timeoutMs: phase2TimeoutMs }
    }

    if (m2.author.id === invokerId && m2.content.trim().toLowerCase() === 'skip') return { skipped: true, reason: 'user_skip' }
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
            const TROOPER_LABEL = config.GENERAL.TROOPER_RANK_LABEL || 'Trooper (10)'
            const EXEMPT_ROLE_IDS = [config.DISCORD.ROLES.EXEMPT].filter(Boolean)
            const PURGE_DEFCON_ROLE_ID = config.DISCORD.ROLES.PURGE_DEFCON
            const SL_PLUS_ROLE_IDS = config.DISCORD.ROLES.RANK ? Object.keys(config.DISCORD.ROLES.RANK).filter(id => id !== '704881591272472596') : []
            const GAR_BOT_USER_ID = config.DISCORD.BOT.GAR_USER_ID || null

            const UNIT_ROLES = []
            if (Array.isArray(config.DISCORD.ROLES.UNIT)) {
                for (const unit of config.DISCORD.ROLES.UNIT) {
                    if (Array.isArray(unit.roles)) for (const role of unit.roles) UNIT_ROLES.push(role)
                }
            }

            const companyRoleMap = buildCompanyRoleMap()

            logger.info(`[STAGE] runId=${runId} config_loaded group=${GROUP_NAME} purgeDefcon=${Boolean(PURGE_DEFCON_ROLE_ID)} exemptCount=${EXEMPT_ROLE_IDS.length} unitRoleCount=${UNIT_ROLES.length} garBot=${GAR_BOT_USER_ID} testMode=${TEST_MODE}`)

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

            const failedByCompany = { Trooper: [], Green: [], Sarlacc: [], Ranger: [], Zeus: [] }
            const demotionList = []
            const kickList = []
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

                let fallbackName = member.nickname || member.user.displayName || member.user.username
                fallbackName = String(fallbackName || 'Unknown').replace(/\[IN\]/g, '').replace(/\s+/g, '')

                let name = fallbackName

                const robloxId = await guard(`db.getRobloxIdByDiscord memberId=${member.id}`, () => database.getRobloxIdByDiscord(member.user.id), null, runId)

                if (robloxId) {
                    const fetchedName = await guard(
                        `roblox.getUsernameFromId robloxId=${robloxId} memberId=${member.id}`,
                        () => retry(() => roblox.getUsernameFromId(robloxId), { tries: 3, baseDelay: 750, label: `roblox.getUsernameFromId(${robloxId})`, runId }),
                        null,
                        runId
                    )
                    if (fetchedName) name = fetchedName
                    else robloxLookupFailCount += 1
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

            logger.info(`[STAGE] runId=${runId} strip_exempt_start roles=${EXEMPT_ROLE_IDS.length} testMode=${TEST_MODE}`)

            let exemptStripped = 0
            if (TEST_MODE) {
                logger.info(`[TEST_MODE] runId=${runId} would_strip_exempt_roles count=${EXEMPT_ROLE_IDS.length}`)
            } else if (EXEMPT_ROLE_IDS.length) {
                for (const member of guild.members.cache.values()) {
                    if (member.user.bot) continue
                    const toRemove = EXEMPT_ROLE_IDS.filter(rid => member.roles.cache.has(rid))
                    for (const rid of toRemove) {
                        const removed = await guard(`roles.remove exempt memberId=${member.id} roleId=${rid}`, () => member.roles.remove(rid, 'Purge: removing exempt role (post-quota-check)'), null, runId)
                        if (removed) exemptStripped += 1
                        await sleep(50)
                    }
                }
            }

            logger.info(`[STAGE] runId=${runId} strip_exempt_done stripped=${exemptStripped}`)

            await safeSend(
                interaction.channel,
                `Scan complete.\nFailed: ${failedCount.total}\nPassed: ${passedCount.total}\n\nPurge roles removed from passers: ${passedCount.purgeCleared}${TEST_MODE ? ' (TEST MODE: not applied)' : ''}\nExempt roles stripped: ${exemptStripped}${TEST_MODE ? ' (TEST MODE: not applied)' : ''}\n\n**Quota check failures: ${quotaFailCount}**${TEST_MODE ? '\nTEST MODE: No Discord roles were changed.' : ''}`,
                'scan_summary',
                runId
            )

            logger.info(`[STAGE] runId=${runId} demotions_start count=${demotionList.length}`)

            if (demotionList.length) {
                await safeSend(
                    interaction.channel,
                    `${TEST_MODE ? 'TEST MODE: No Discord roles will be changed and no confirmations will be awaited.\n\n' : ''}# Starting demotions for ${demotionList.length} users.\nTimeouts:\n- You have 5 minutes to paste the command.\n- Then 5 minutes for the GAR confirmation embed.\n\nType \`skip\` at any prompt to move on.`,
                    'demotions_intro',
                    runId
                )
            }

            let dIdx = 0
            for (const d of demotionList) {
                dIdx += 1

                const isSL = SL_PLUS_ROLE_IDS.length ? d.member.roles.cache.some(r => SL_PLUS_ROLE_IDS.includes(r.id)) : false
                const cmd = managegroupRankCmd(GROUP_NAME, d.robloxName)
                const preface = `<@${d.memberId}> Demote **${d.robloxName}** [${d.company}] ${isSL ? '- <:warning:1297618648810393630> Heads up: SL+' : ''}.\nPaste this command within 5 minutes, or type \`skip\`:`
                const block = '```' + cmd + '```'

                await safeSend(interaction.channel, `${preface}\n${block}`, `demotion_prompt_${dIdx}`, runId)

                if (TEST_MODE) {
                    logger.info(`[TEST_MODE] runId=${runId} would_demote memberId=${d.memberId} roblox=${d.robloxName} company=${d.company}`)
                    await safeSend(interaction.channel, `TEST MODE: would demote **${d.robloxName}**. Skipping confirmation wait.`, `demotion_testmode_${dIdx}`, runId)
                    continue
                }

                const res = await waitForUserOrEmbed(interaction.channel, {
                    invokerId: interaction.user.id,
                    needCmd: true,
                    cmdExact: cmd,
                    garBotId: GAR_BOT_USER_ID,
                    embedMatch: garSetTrooperMatcher(GROUP_NAME, d.robloxName),
                    runId,
                    phase1TimeoutMs: 300000,
                    phase2TimeoutMs: 300000,
                    contextLabel: `demotion for ${d.robloxName}`
                })

                if (res.skipped) {
                    await safeSend(interaction.channel, `Skipped ${d.robloxName}.`, `demotion_skipped_${dIdx}`, runId)
                    continue
                }

                await safeSend(interaction.channel, `Confirmed demotion for **${d.robloxName}** to \`${TROOPER_LABEL}\`.`, `demotion_confirmed_${dIdx}`, runId)

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
                    `${TEST_MODE ? 'TEST MODE: No Discord roles will be changed and no confirmations will be awaited.\n\n' : ''}# Starting kicks for ${kickList.length} Troopers on purge defcon.\nTimeouts:\n- You have 5 minutes to paste the kick command.\n- Then 5 minutes for the GAR confirmation embed.\n\nType \`skip\` at any prompt to move on.`,
                    'kicks_intro',
                    runId
                )
            }

            let kIdx = 0
            for (const k of kickList) {
                kIdx += 1

                const isSL = SL_PLUS_ROLE_IDS.length ? k.member.roles.cache.some(r => SL_PLUS_ROLE_IDS.includes(r.id)) : false
                const cmd = `;managegroup ${GROUP_NAME} kick ${k.robloxName}`
                const preface = `<@${k.memberId}> Kick **${k.robloxName}** [Trooper]${isSL ? ' - <:warning:1297618648810393630> Heads up: SL+' : ''}.\nPaste this command within 5 minutes and also kick them from Discord. Type \`skip\` to skip:`
                const block = '```' + cmd + '```'

                await safeSend(interaction.channel, `${preface}\n${block}`, `kick_prompt_${kIdx}`, runId)

                if (TEST_MODE) {
                    logger.info(`[TEST_MODE] runId=${runId} would_kick memberId=${k.memberId} roblox=${k.robloxName}`)
                    await safeSend(interaction.channel, `TEST MODE: would kick **${k.robloxName}**. Skipping confirmation wait.`, `kick_testmode_${kIdx}`, runId)
                    continue
                }

                const res = await waitForUserOrEmbed(interaction.channel, {
                    invokerId: interaction.user.id,
                    needCmd: true,
                    cmdExact: cmd,
                    garBotId: GAR_BOT_USER_ID,
                    embedMatch: garKickedMatcher(GROUP_NAME, k.robloxName),
                    runId,
                    phase1TimeoutMs: 300000,
                    phase2TimeoutMs: 300000,
                    contextLabel: `kick for ${k.robloxName}`
                })

                if (res.skipped) {
                    await safeSend(interaction.channel, `Skipped ${k.robloxName}.`, `kick_skipped_${kIdx}`, runId)
                    continue
                }

                await safeSend(interaction.channel, `Confirmed **${k.robloxName}** kicked from **${GROUP_NAME}**.`, `kick_confirmed_${kIdx}`, runId)
            }

            logger.info(`[STAGE] runId=${runId} kicks_done count=${kickList.length}`)

            logger.info(`[STAGE] runId=${runId} reports_build_start`)

            const attachments = []
            const now = new Date().toISOString().slice(0, 10)

            for (const c of ['Trooper', 'Green', 'Sarlacc', 'Ranger', 'Zeus']) {
                const failed = failedByCompany[c]
                if (!failed || failed.length === 0) continue

                const demotedNames = demotionList.filter(x => x.company === c).map(x => `- ${x.robloxName} <@${x.memberId}>`)
                const kickedNames = c === 'Trooper' ? kickList.map(x => `- ${x.robloxName} <@${x.memberId}>`) : []

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
