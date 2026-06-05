'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const database = require('../../api/database')
const { filterRowsByRole, formatRoleFilterLabel } = require('../utils/topRoleFilter')

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
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Only include users with this Discord role')
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const allTime = interaction.options.getBoolean('all-time') ?? false
            const limit = interaction.options.getInteger('count') || 5
            const roleFilter = interaction.options.getRole('role')

            let rows = allTime
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

            rows = await filterRowsByRole(interaction, normalized, roleFilter, row => row.discordId)
            if (rows.length === 0) {
                await interaction.editReply({ content: roleFilter ? `No reviewer data found for users with the ${roleFilter.name} role.` : '<:warning:1297618648810393630> `No reviewer data available right now`' })
                return
            }

            sortReviewerRows(rows)
            const topRows = rows.slice(0, limit)

            const selfIndex = rows.findIndex(row => row.discordId === interaction.user.id)

            const lines = topRows.map((row, index) => {
                const highlight = row.discordId === interaction.user.id
                const line = `${index + 1}. <@${row.discordId}> **${row.count}**`
                return highlight ? `**${line}**` : line
            })

            if (selfIndex >= limit) {
                const selfRow = rows[selfIndex]
                lines.push(`**${selfIndex + 1}. <@${selfRow.discordId}> ${selfRow.count}**`)
            }

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle(`Top Minor Reviewers ${allTime ? 'All-Time' : 'This Week'}${formatRoleFilterLabel(roleFilter)}`)
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
