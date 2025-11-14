'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUsernameFromId } = require('../../api/roblox.js');
const { EMBED_COLOR } = require('../../../config.json');
const database = require('../../api/database.js');

/**
 * @typedef {Object} PointsRow
 * @property {string|number} robloxId
 * @property {number} eventPoints
 */

/**
 * Fetch EP rows for the given scope
 * @param {boolean} allTime
 * @returns {Promise<PointsRow[]>}
 */
async function fetchPointsData(allTime) {
    if (allTime) {
        const users = await database.getAllUsers().catch(() => [])
        const robloxIds = Array.isArray(users) ? users.map(u => u.robloxId).filter(Boolean) : []
        return await database.getAllTimeEventPointsBatch(robloxIds).catch(() => [])
    } else {
        const robloxIds = await database.getUsersWithWeeklyEvents().catch(() => [])
        return await database.getCurrentEventPointsBatch(robloxIds).catch(() => [])
    }
}

/**
 * Resolve a display tag for a robloxId
 * Prefers Discord mention if mapped, else Roblox username, else code-wrapped ID
 * @param {string|number} robloxId
 * @param {Map<string|number, string>} idMap robloxId -> discordId
 * @returns {Promise<string>}
 */
async function formatTag(robloxId, idMap) {
    const discordId = idMap.get(robloxId)
    if (discordId) return `<@${discordId}>`
    try {
        const name = await getUsernameFromId(robloxId)
        if (name) return name
    } catch { }
    return '`' + String(robloxId) + '`'
}

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('ep-top')
        .setDescription('Show the top 5 users by EP')
        .addBooleanOption(option =>
            option
                .setName('all-time')
                .setDescription('If true, use all-time EP')
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const allTime = interaction.options.getBoolean('all-time') ?? false
            const discordUser = interaction.user

            const pointsData = await fetchPointsData(allTime)
            if (!Array.isArray(pointsData) || pointsData.length === 0) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `No EP data available right now`' })
                return
            }

            // Sort and take top 5
            pointsData.sort((a, b) => (b.eventPoints || 0) - (a.eventPoints || 0))
            const top5 = pointsData.slice(0, 5)

            // Batch fetch Discord IDs for top 5
            const discordData = await database.getDiscordIdsBatch(top5.map(u => u.robloxId)).catch(() => [])
            const idMap = new Map(discordData.map(d => [d.robloxId, d.discordId]))

            // Determine invoking user's rank
            const selfRobloxId = await database.getRobloxIdByDiscord(discordUser.id).catch(() => null)
            let rankIndex = -1
            if (selfRobloxId) rankIndex = pointsData.findIndex(u => u.robloxId == selfRobloxId)

            // Build lines for top 5
            const lines = []
            for (let i = 0; i < top5.length; i++) {
                const u = top5[i]
                const tag = await formatTag(u.robloxId, idMap)
                const pts = typeof u.eventPoints === 'number' ? u.eventPoints : 0
                const highlight = rankIndex >= 0 && rankIndex < 5 && u.robloxId == selfRobloxId
                const line = `${i + 1}. ${highlight ? '**' : ''}${tag} ${pts} points${highlight ? '**' : ''}`
                lines.push(line)
            }

            // If invoking user is ranked 6th or lower, append their own line
            if (rankIndex >= 5) {
                const u = pointsData[rankIndex]
                const pts = typeof u.eventPoints === 'number' ? u.eventPoints : 0
                lines.push(`**${rankIndex + 1}. <@${discordUser.id}> ${pts} points**`)
            }

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle(`Top Event Points ${allTime ? 'All-Time' : 'This Week'}`)
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields({ name: 'Top 5 Users', value: lines.join('\n') })

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get top EP. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}