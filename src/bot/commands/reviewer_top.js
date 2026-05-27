'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const database = require('../../api/database')

/**
 * @param {Array<{discordId: string, count: number}>} rows
 */
function sortReviewerRows(rows) {
    rows.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return String(a.discordId).localeCompare(String(b.discordId))
    })
}

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('reviewer_top')
        .setDescription('Show top minor officer reviewers')
        .addBooleanOption(option =>
            option
                .setName('all-time')
                .setDescription('Use all-time review totals')
        )
        .addIntegerOption(option =>
            option
                .setName('count')
                .setDescription('Enter how many users to show')
                .setMinValue(1)
                .setMaxValue(15)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const allTime = interaction.options.getBoolean('all-time') ?? false
            const limit = interaction.options.getInteger('count') || 5

            const rows = allTime
                ? await database.getAllTimeMinorOfficerReviewCounts().catch(() => [])
                : await database.getWeeklyMinorOfficerReviewCounts().catch(() => [])

            if (!Array.isArray(rows) || rows.length === 0) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `No reviewer data available right now`' })
                return
            }

            const normalized = rows.map((row) => ({
                discordId: String(row.discordId),
                count: Number(row.count) || 0
            }))

            sortReviewerRows(normalized)
            const topRows = normalized.slice(0, limit)

            const selfIndex = normalized.findIndex(row => row.discordId === interaction.user.id)

            const lines = topRows.map((row, index) => {
                const highlight = row.discordId === interaction.user.id
                const line = `${index + 1}. <@${row.discordId}> **${row.count}**`
                return highlight ? `**${line}**` : line
            })

            if (selfIndex >= limit) {
                const selfRow = normalized[selfIndex]
                lines.push(`**${selfIndex + 1}. <@${selfRow.discordId}> ${selfRow.count}**`)
            }

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle(`Top Minor Reviewers ${allTime ? 'All-Time' : 'This Week'}`)
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields({
                    name: `Top ${topRows.length} Reviewers`,
                    value: lines.join('\n')
                })

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get minor top. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
