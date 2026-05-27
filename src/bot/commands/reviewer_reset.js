'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database')
const {
    createReviewerResetEmbed,
    summarizeReviewerReset
} = require('../utils/reviewerAutomation.js')

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
            const { reviewersCleared, reviewsCleared } = summarizeReviewerReset(rows)

            await database.resetWeeklyMinorOfficerReviewCounts()

            const embed = createReviewerResetEmbed({
                rows,
                guildIconUrl: interaction.guild?.iconURL() ?? undefined,
                footerText: `WEEKLY REVIEWER RESET ${interaction.user.id}`,
                executedBy: `Executed by: ${interaction.user} (${interaction.user.id})`
            })

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
