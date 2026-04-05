'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const database = require('../../api/database.js')

const LoggerClass = require('../../api/logger.js')
const logger = new LoggerClass('ReviewerReset', 'BOT')

module.exports = {
    permission: 'FFCNC',
    data: new SlashCommandBuilder()
        .setName('reviewer_reset')
        .setDescription("Reset this week's minor officer reviewer data"),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const rows = await database.getWeeklyMinorOfficerReviewCounts().catch(() => [])
            const normalized = Array.isArray(rows)
                ? rows.map((row) => ({
                    count: Number(row.count) || 0
                }))
                : []

            const reviewersCleared = normalized.length
            const reviewsCleared = normalized.reduce((sum, row) => sum + row.count, 0)

            await database.resetWeeklyMinorOfficerReviewCounts()

            const embed = new EmbedBuilder()
                .setFooter({ text: `WEEKLY REVIEWER RESET ${interaction.user.id}`, iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Reset Weekly Reviewer Data')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .setDescription(`Executed by: ${interaction.user} (${interaction.user.id})`)
                .addFields([
                    { name: 'Reviewers cleared', value: String(reviewersCleared), inline: true },
                    { name: 'Review count removed', value: String(reviewsCleared), inline: true }
                ])

            logger.info(
                `Weekly reviewer reset completed by ${interaction.user.username} (${interaction.user.id}); ` +
                `reviewersCleared=${reviewersCleared} reviewsCleared=${reviewsCleared}`
            )

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            logger.error('Failed to reset weekly reviewer data', err)
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to reset weekly reviewer data. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
