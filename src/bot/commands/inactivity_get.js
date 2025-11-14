'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const { EMBED_COLOR } = require('../../../config.json');
const database = require('../../api/database.js')

/**
 * Convert a millisecond timestamp or Date into a Discord time tag
 * We use the short date formatter `:d` for a concise display
 * @param {number|Date|string} v
 * @returns {string}
 */
function toDiscordDateTag(v) {
    const ms = v instanceof Date ? v.getTime() : Number(v)
    const unix = Math.floor(ms / 1000)
    return `<t:${unix}:d>`
}

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('inactivity-get')
        .setDescription("Get a user's inactivity details")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to look up')
                .setRequired(true)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            const member = interaction.options.getMember('user')
            if (!member || member.user.bot) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You cannot check inactivity for that user!`' })
                return
            }

            // Fetch the stored inactivity notice for this Discord user id
            const inactivityData = await database.getInactivity(member.id).catch(() => null)
            if (!inactivityData) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `That user is not on inactivity notice!`' })
                return
            }

            // Reason fallback
            const reason = String(inactivityData.reason || 'None provided').slice(0, 512)

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Inactivity Notice Details')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields([
                    { name: 'User', value: `<@${member.id}>`, inline: true },
                    { name: 'Date of Return', value: toDiscordDateTag(inactivityData.date), inline: true },
                    { name: 'Reason', value: reason, inline: true }
                ])

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get inactivity details. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}