'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const database = require('../../api/database.js')

/**
 * @param {Array<{discordId: string, count: number}>} rows
 */
function sortReviewerRows(rows) {
    rows.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return String(a.discordId).localeCompare(String(b.discordId))
    })
}

/**
 * Keep each chunk under Discord embed description limits.
 * @param {string[]} lines
 * @returns {string[][]}
 */
function chunkLines(lines) {
    const chunks = []
    let current = []
    let currentLength = 0
    const maxChars = 3800

    for (const line of lines) {
        const nextLength = currentLength + (current.length ? 1 : 0) + line.length
        if (nextLength > maxChars && current.length) {
            chunks.push(current)
            current = [line]
            currentLength = line.length
            continue
        }
        current.push(line)
        currentLength = nextLength
    }

    if (current.length) chunks.push(current)
    return chunks
}

module.exports = {
    permission: 'FFCNC',
    data: new SlashCommandBuilder()
        .setName('reviewer_list')
        .setDescription('Show all weekly minor officer reviewers and counts'),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const rows = await database.getWeeklyMinorOfficerReviewCounts().catch(() => [])
            if (!Array.isArray(rows) || rows.length === 0) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `No weekly reviewer data available right now`' })
                return
            }

            const normalized = rows.map((row) => ({
                discordId: String(row.discordId),
                count: Number(row.count) || 0
            }))

            sortReviewerRows(normalized)

            const lines = normalized.map((row, index) =>
                `${index + 1}. <@${row.discordId}> ${row.count}`
            )

            const chunks = chunkLines(lines)
            const embeds = chunks.map((chunk, index) =>
                new EmbedBuilder()
                    .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                    .setTitle(`Weekly Minor Reviewers (${index + 1}/${chunks.length})`)
                    .setColor(EMBED_COLOR)
                    .setTimestamp()
                    .setDescription(chunk.join('\n'))
            )

            await interaction.editReply({ embeds: [embeds[0]] })

            for (let i = 1; i < embeds.length; i++) {
                await interaction.followUp({ embeds: [embeds[i]] })
            }
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get minor list. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
