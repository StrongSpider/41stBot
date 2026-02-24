'use strict'

const config = require('../../../config.json')
const { COMPANY: COMPANY_DISCORD_ROLES } = config.DISCORD.ROLES
const { EMBED_COLOR } = config.GENERAL
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js')
const { sendClearWeek } = require('../../api/webhook.js')
const database = require('../../api/database.js')
const roblox = require('../../api/roblox.js')
const path = require('path')
const fs = require('fs')

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('TrackerReset', 'BOT')

/**
 * Strip [IN] tag and collapse spaces for cleaner name fallbacks
 * @param {string} s
 */
function cleanDisplayName(s) {
    return String(s || '')
        .replace(/\[IN\]/g, '')
        .replace(/\s+/g, '')
}

module.exports = {
    permission: 'FFCNC',
    data: new SlashCommandBuilder()
        .setName('tracker-reset')
        .setDescription("Reset this week's tracker (events and EP)"),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            const guild = interaction.guild
            if (!guild) {
                await interaction.editReply({ content: 'This command can only be used in a server.' })
                return
            }

            // Ensure the member cache is warm for role lookups
            await guild.members.fetch().catch(() => { })

            /**
             * Collect relevant member info for later mapping
             */
            async function getMembers() {
                const data = []
                for (const member of guild.members.cache.values()) {
                    if (member.user.bot) continue

                    let fallbackName = member.nickname || member.displayName || member.user.displayName || member.user.username
                    fallbackName = cleanDisplayName(fallbackName)

                    let name = fallbackName
                    try {
                        const robloxId = await database.getRobloxIdByDiscord(member.user.id)
                        if (robloxId) {
                            const fetchedName = await roblox.getUsernameFromId(robloxId)
                            if (fetchedName) name = fetchedName
                        }
                    } catch { }

                    const roles = member.roles.cache.map(r => r.id)
                    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) roles.push('admin')

                    data.push({ id: member.user.id, username: name, roles })
                }
                return data
            }

            // Gather all users with weekly activity
            const robloxIds = await database.getUsersWithWeeklyEvents().catch(() => [])

            // Prepare backup payload pieces
            let users = []
            let events = []

            if (Array.isArray(robloxIds) && robloxIds.length > 0) {
                const [pointsList, userEventsList, discordList, membersResp] = await Promise.all([
                    database.getCurrentEventPointsBatch(robloxIds),
                    database.getWeeklyUserEventsBatch(robloxIds),
                    database.getDiscordIdsBatch(robloxIds),
                    getMembers()
                ])

                const members = membersResp
                const pointsMap = Object.fromEntries((pointsList || []).map(o => [o.robloxId, o.eventPoints]))
                const eventsRawMap = Object.fromEntries((userEventsList || []).map(o => [o.robloxId, Array.isArray(o.events) ? o.events : []]))
                const discordMap = Object.fromEntries((discordList || []).map(o => [o.robloxId, o.discordId]))
                const allEventIds = [...new Set((userEventsList || []).flatMap(o => Array.isArray(o.events) ? o.events : []))]
                const weeklyDetails = allEventIds.length ? await database.getWeeklyEventsBatch(allEventIds) : []
                const weeklyMap = Object.fromEntries((weeklyDetails || []).map(e => [e.eventId, e]))

                // Build the user entries for the backup file
                users = await Promise.all(robloxIds.map(async robloxId => {
                    const discordId = discordMap[robloxId]
                    const username = robloxId ? await roblox.getUsernameFromId(+robloxId).catch(() => null) : null
                    const eventIds = eventsRawMap[robloxId] || []

                    // Map event ids to minimal objects with name and link
                    const evts = eventIds
                        .map(id => {
                            const e = weeklyMap[id] || {}
                            return { name: e.type, link: e.message }
                        })
                        .filter(e => e.name && e.link)

                    // Try to resolve a company label via configured role map
                    let company = 'Unknown'
                    const member = members.find(m => m.id === discordId)
                    if (member && Array.isArray(member.roles)) {
                        const matchingRole = member.roles.find(r => COMPANY_DISCORD_ROLES[r])
                        if (matchingRole) company = COMPANY_DISCORD_ROLES[matchingRole]
                    }

                    return {
                        username,
                        company,
                        eventPoints: pointsMap[robloxId] || 0,
                        events: evts
                    }
                }))

                // Also capture the raw weekly event ids present this week
                events = await database.getWeeklyEventIds().catch(() => [])
            } else {
                // No users with weekly events. Still capture existing weekly ids if any.
                events = await database.getWeeklyEventIds().catch(() => [])
            }

            // Clear weekly data in storage
            await database.clearAllWeeklyEvents()
            await database.resetAllEventPoints()

            // Write backup file
            const date = new Date().toISOString().split('T')[0]
            const backupDir = path.join(__dirname, '../../../data/backup')
            try { fs.mkdirSync(backupDir, { recursive: true }) } catch { }
            const fileName = path.join(backupDir, `${date}.json`)
            try { fs.writeFileSync(fileName, JSON.stringify({ users, events }, null, 2), 'utf8') } catch { }

            // Notify via webhook
            try { await sendClearWeek({ discordId: interaction.user.id }) } catch { }

            await database.setEventEpLock(false)
            logger.info(`[EVENT_EP_LOCK] enabled=false`)

            // Build confirmation embed
            const resetEmbed = new EmbedBuilder()
                .setFooter({ text: `WEEKLY RESET ${interaction.user.id}`, iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Reset Weekly Tracker')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .setDescription(`Executed by: ${interaction.user} (${interaction.user.id})`)
                .addFields([
                    { name: 'Users in backup', value: String(users.length), inline: true },
                    { name: 'Events in backup', value: String(events.length), inline: true }
                ])

            await interaction.editReply({ embeds: [resetEmbed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to reset weekly tracker. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
