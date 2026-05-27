'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')
const {
    REVIEWER_LIST_EMPTY_MESSAGE,
    createWeeklyReviewerListEmbeds
} = require('../utils/reviewerAutomation.js')

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
                await interaction.editReply({ content: REVIEWER_LIST_EMPTY_MESSAGE })
                return
            }

            const embeds = createWeeklyReviewerListEmbeds(rows, interaction.guild?.iconURL() ?? undefined)
            if (embeds.length === 0) {
                await interaction.editReply({ content: REVIEWER_LIST_EMPTY_MESSAGE })
                return
            }

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
