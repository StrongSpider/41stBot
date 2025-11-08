'use strict'

const { SlashCommandBuilder, AttachmentBuilder, PermissionsBitField, MessageFlags } = require('discord.js')

const quota = require('../../api/quota.js')
const config = require('../../../config.json');
const database = require('../../api/database.js')
const roblox = require('../../api/roblox.js')

/**
 * /purge command
 *
 * Run the weekly purge flow:
 *  - Scan all members and check quota status
 *  - Clear purge-defcon role from passers and add it to new failures
 *  - Build demotion and kick queues
 *  - Interactively confirm demotions and kicks by watching for GAR bot embeds
 *  - Produce per-company text reports as attachments
 *
 * Visibility
 *  - This command is interactive and posts in-channel
 *  - Errors fall back to an ephemeral reply with MessageFlags.Ephemeral
 *
 * Notes
 *  - Keep messages plain ASCII
 *  - Heavy operations include full member fetch, per-user quota checks, and role edits
 *
 * @file purge.js
 */

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
 * Build a roleId -> short company name map from config.COMPANY_DISCORD_ROLES
 */
function buildCompanyRoleMap() {
    const map = {}
    const src = config.COMPANY_DISCORD_ROLES || {}
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
 * Example embed text parsed:
 *  Set [user (123)](url) to the `Trooper (10)` rank in the **41st** group.
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
 * Example embed text parsed:
 *  Kicked [user (123)](url) from the **41st** group.
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

/**
 * Wait for either the invoker to issue a command/skip, or for a matching GAR embed
 * Returns { skipped: true } or { confirmed: true }
 * @param {import('discord.js').TextChannel} channel
 * @param {{ invokerId:string, needCmd:boolean, cmdExact:string, garBotId?:string|null, embedMatch:(m:any)=>boolean, prompt?:string }} opts
 */
async function waitForUserOrEmbed(channel, { invokerId, needCmd, cmdExact, garBotId, embedMatch, prompt }) {
    if (prompt) await channel.send(prompt)

    // Phase 1: Require either `skip` or the exact managegroup command from invoker
    if (needCmd) {
        const filter1 = m => m.author.id === invokerId && (m.content.trim().toLowerCase() === 'skip' || m.content.trim() === cmdExact || m.content.trim() === cmdExact + '/')
        const c1 = await channel.awaitMessages({ filter: filter1, max: 1 })
        const m1 = c1.first()
        if (!m1) return { skipped: true }
        if (m1.content.trim().toLowerCase() === 'skip') return { skipped: true }
    }

    // Phase 2: wait for GAR bot embed or skip
    const filter2 = m => {
        if (m.author.id === invokerId && m.content.trim().toLowerCase() === 'skip') return true
        if (garBotId && m.author.id !== garBotId) return false
        if (!garBotId && !m.author.bot) return false
        return embedMatch(m)
    }

    while (true) {
        const c2 = await channel.awaitMessages({ filter: filter2, max: 1, time: 300000 }) // 5 min window
        const m2 = c2.first()
        if (!m2) {
            await channel.send('No confirmation embed seen. Type `skip` to move on or wait for the bot embed.')
            continue
        }
        if (m2.author.id === invokerId && m2.content.trim().toLowerCase() === 'skip') return { skipped: true }
        return { confirmed: true }
    }
}

module.exports = {
    permission: 'FFCNC',
    data: new SlashCommandBuilder().
        setName('purge').
        setDescription('Run weekly purge'),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const guild = interaction.guild
            if (!guild) {
                await interaction.editReply({ content: 'This can only be used in a guild.', flags: MessageFlags.Ephemeral })
                return
            }

            const GROUP_NAME = config.GROUP_NAME || '41st'
            const TROOPER_LABEL = config.TROOPER_RANK_LABEL || 'Trooper (10)'
            const EXEMPT_ROLE_IDS = [config.EXEMPT_DISCORD_ROLE_ID]
            const PURGE_DEFCON_ROLE_ID = config.DISCORD_PURGE_DEFCON_ROLE_ID
            const SL_PLUS_ROLE_IDS = config.RANK_DISCORD_ROLES ? Object.keys(config.RANK_DISCORD_ROLES).filter(id => id !== '704881591272472596') : []
            const GAR_BOT_USER_ID = config.GAR_BOT_USER_ID || null

            // Flatten unit roles from config for removal after demotions
            const UNIT_ROLES = []
            if (Array.isArray(config.UNIT_ROLES)) {
                for (const unit of config.UNIT_ROLES) {
                    if (Array.isArray(unit.roles)) for (const role of unit.roles) UNIT_ROLES.push(role)
                }
            }

            const companyRoleMap = buildCompanyRoleMap()
            const companies = ['Trooper', 'Green', 'Sarlacc', 'Ranger', 'Zeus']

            await interaction.editReply('This command is interactive and cannot be undone. Make sure companies have CMOTW before running. Type `confirm` to continue, or anything else to cancel.')

            // Confirm starter prompt from invoker in the same channel
            const conf = await interaction.channel.awaitMessages({ filter: m => m.author.id === interaction.user.id, max: 1, time: 60000 })
            const reply = conf.first()
            if (!reply || reply.content.trim().toLowerCase() !== 'confirm') {
                await interaction.followUp('Cancelled.')
                return
            }

            await interaction.followUp('Beginning purge scan...')

            // Fetch all members into cache before scanning
            await guild.members.fetch()

            const failedByCompany = { Trooper: [], Green: [], Sarlacc: [], Ranger: [], Zeus: [] }
            const demotionList = []
            const kickList = []
            const passedCount = { total: 0, purgeCleared: 0 }
            const failedCount = { total: 0 }

            // Scan members
            for (const member of guild.members.cache.values()) {
                if (member.user.bot) continue

                // Best-effort Roblox name lookup, fall back to cleaned nickname/username
                let fallbackName = member.nickname || member.user.displayName || member.user.username
                fallbackName = fallbackName.replace(/\[IN\]/g, '').replace(/\s+/g, '')

                let name = fallbackName
                try {
                    const robloxId = await database.getRobloxIdByDiscord(member.user.id)
                    if (robloxId) {
                        const fetchedName = await roblox.getUsernameFromId(robloxId)
                        if (fetchedName) name = fetchedName
                    }
                } catch { }

                // Build role list for quota check and add a pseudo admin flag
                const roles = member.roles.cache.map(r => r.id)
                if (member.permissions.has(PermissionsBitField.Flags.Administrator)) roles.push('admin')

                // Quota check can throw, keep going if it does
                let report
                try {
                    report = await quota.checkQuota({ id: member.id, username: name, roles })
                } catch (e) {
                    await interaction.channel.send(`Quota check failed for ${member}: ${e.message}`)
                    continue
                }

                const company = firstCompanyFor(member, companyRoleMap)
                const onPurge = report?.purge

                if (report && report.metPurgeQuotas) {
                    passedCount.total += 1
                    if (onPurge && PURGE_DEFCON_ROLE_ID) {
                        try {
                            await member.roles.remove(PURGE_DEFCON_ROLE_ID, 'Passed quota: clearing purge defcon')
                            passedCount.purgeCleared += 1
                        } catch { }
                    }
                    continue
                }

                if (report && report.status === 'EXEMPT') continue

                failedCount.total += 1
                const entry = {
                    memberId: member.id,
                    member,
                    robloxName: report?.username || name,
                    onPurge,
                    company: company || 'Unassigned',
                    purge: onPurge,
                    quotas: report?.quotas || [],
                    status: report?.status || 'FAILED'
                }
                if (company && failedByCompany[company]) failedByCompany[company].push(entry)

                if (onPurge) {
                    if (company === 'Trooper') kickList.push(entry)
                    else demotionList.push(entry)
                } else if (PURGE_DEFCON_ROLE_ID) {
                    await member.roles.add(PURGE_DEFCON_ROLE_ID, 'Failed quota')
                }
            }

            // Post-scan: remove exempt roles from all users
            let exemptStripped = 0
            if (EXEMPT_ROLE_IDS.length) {
                for (const member of guild.members.cache.values()) {
                    if (member.user.bot) continue
                    const toRemove = EXEMPT_ROLE_IDS.filter(rid => member.roles.cache.has(rid))
                    for (const rid of toRemove) {
                        try {
                            await member.roles.remove(rid, 'Purge: removing exempt role (post-quota-check)')
                            exemptStripped++
                        } catch { }
                        await sleep(50)
                    }
                }
            }

            await interaction.channel.send(`Scan complete. Failed: ${failedCount.total}. Passed: ${passedCount.total}. Purge roles cleared from passers: ${passedCount.purgeCleared}. Exempt roles stripped: ${exemptStripped}.`)

            // Demotions flow
            if (demotionList.length) {
                await interaction.channel.send(`Starting demotions for ${demotionList.length} users (on purge defcon, non-Trooper). I will wait for your GAR confirmations. Type \`skip\` at any prompt to move on.`)
            }

            for (const d of demotionList) {
                const isSL = SL_PLUS_ROLE_IDS.length ? d.member.roles.cache.some(r => SL_PLUS_ROLE_IDS.includes(r.id)) : false
                const cmd = managegroupRankCmd(GROUP_NAME, d.robloxName)
                const preface = `<@${d.memberId}> Demote **${d.robloxName}** [${d.company}] ${isSL ? '- <:warning:1297618648810393630> Heads up: SL+' : ''}. Post this command, or type \`skip\`:`
                const block = '```' + cmd + '```'
                await interaction.channel.send(`${preface}\n${block}`)

                const { skipped, confirmed } = await waitForUserOrEmbed(interaction.channel, {
                    invokerId: interaction.user.id,
                    needCmd: true,
                    cmdExact: cmd,
                    garBotId: GAR_BOT_USER_ID,
                    embedMatch: garSetTrooperMatcher(GROUP_NAME, d.robloxName)
                })

                if (skipped) {
                    await interaction.channel.send(`Skipped ${d.robloxName}.`)
                    continue
                }

                if (confirmed) {
                    await interaction.channel.send(`Confirmed demotion for **${d.robloxName}** to \`${TROOPER_LABEL}\`.`)
                    if (UNIT_ROLES.length) {
                        const toRemove = d.member.roles.cache.filter(r => UNIT_ROLES.includes(r.id)).map(r => r.id)
                        for (const rid of toRemove) {
                            try {
                                await d.member.roles.remove(rid, 'Demotion: removing company role')
                            } catch { }
                            await sleep(50)
                        }
                        if (toRemove.length) {
                            await interaction.channel.send(`Removed ${toRemove.length} company role(s) from <@${d.memberId}> after demotion.`)
                        }
                    }
                }
            }

            // Kicks flow (Trooper + Purge)
            if (kickList.length) {
                await interaction.channel.send(`Starting kicks for ${kickList.length} Troopers on purge defcon. I will wait for GAR confirmation after you run the command. Also remember to kick them from the Discord server.`)
            }

            for (const k of kickList) {
                const isSL = SL_PLUS_ROLE_IDS.length ? k.member.roles.cache.some(r => SL_PLUS_ROLE_IDS.includes(r.id)) : false
                const cmd = `;managegroup ${GROUP_NAME} kick ${k.robloxName}`
                const preface = `<@${k.memberId}> Kick **${k.robloxName}** [Trooper]${isSL ? ' - <:warning:1297618648810393630> Heads up: SL+' : ''}. Post this command and also kick them from the Discord. Type \`skip\` to skip:`
                const block = '```' + cmd + '```'
                await interaction.channel.send(`${preface}\n${block}`)

                const { skipped, confirmed } = await waitForUserOrEmbed(interaction.channel, {
                    invokerId: interaction.user.id,
                    needCmd: true,
                    cmdExact: cmd,
                    garBotId: GAR_BOT_USER_ID,
                    embedMatch: garKickedMatcher(GROUP_NAME, k.robloxName)
                })

                if (skipped) {
                    await interaction.channel.send(`Skipped ${k.robloxName}.`)
                    continue
                }
                if (confirmed) await interaction.channel.send(`Confirmed **${k.robloxName}** kicked from **${GROUP_NAME}**.`)
            }

            // Build company text files
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
                if (c === 'Trooper') {
                    text += `\n## Kicked (${kickedNames.length})\n` + (kickedNames.length ? kickedNames.join('\n') + '\n' : 'None\n')
                }

                const fileName = `${c.replace(/\s+/g, '_').toLowerCase()}_purge_${now}.txt`
                attachments.push(new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: fileName }))
            }

            if (attachments.length) await interaction.channel.send({ content: 'Company reports:', files: attachments })
            else await interaction.channel.send('No company failures to report.')

            // Dump company role IDs (from config) to console for verification
            try {
                const ids = Object.keys(config.COMPANY_DISCORD_ROLES || {})
                console.log('COMPANY_DISCORD_ROLES IDs:', ids.join(', '))
            } catch { }
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Purge failed. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}