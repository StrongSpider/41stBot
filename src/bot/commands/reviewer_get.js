'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const database = require('../../api/database.js')

/**
 * @param {string} discordId
 * @param {boolean} allTime
 * @returns {Promise<number>}
 */
async function getReviewerCount(discordId, allTime) {
    const rows = allTime
        ? await database.getAllTimeMinorOfficerReviewCounts().catch(() => [])
        : await database.getWeeklyMinorOfficerReviewCounts().catch(() => [])

    if (!Array.isArray(rows)) return 0

    const match = rows.find((row) => String(row.discordId) === String(discordId))
    return match ? (Number(match.count) || 0) : 0
}

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('reviewer_get')
        .setDescription("Show a user's minor officer review count")
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Select the user to check, or leave blank for yourself')
        )
        .addBooleanOption(option =>
            option
                .setName('all-time')
                .setDescription('Use all-time review totals')
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const discordUser = interaction.options.getUser('user') || interaction.user
            const allTime = interaction.options.getBoolean('all-time') ?? false

            if (discordUser.bot) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You cannot check a bot\'s reviewer count!`' })
                return
            }

            const reviewCount = await getReviewerCount(discordUser.id, allTime)
            const displayName = discordUser.globalName || discordUser.username

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle(`${displayName}'s ${allTime ? 'All-Time' : 'Weekly'} Minor Officer Reviews`)
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields(
                    { name: 'User', value: `<@${discordUser.id}>`, inline: true },
                    { name: 'Reviews', value: String(reviewCount), inline: true }
                )

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get reviewer count. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
