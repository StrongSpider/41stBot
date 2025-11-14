'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const { getUsernameFromId } = require('../../api/roblox.js')
const { EMBED_COLOR } = require('../../../config.json');
const database = require('../../api/database.js')

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('ep-get')
        .setDescription('Get a user\'s event points')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to check (defaults to you)')
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const discordUser = interaction.options.getUser('user') || interaction.user
            const robloxId = await database.getRobloxIdByDiscord(discordUser.id)

            if (robloxId == null) {
                const youRequestedSelf = !interaction.options.getUser('user')
                const msg = youRequestedSelf
                    ? '<:warning:1297618648810393630> `Your roblox account is not verified with the 41st Bot! Run the command /verify...`'
                    : '<:warning:1297618648810393630> `The requested user does not have a verified roblox account!`'
                await interaction.editReply({ content: msg })
                return
            }

            const robloxUsername = await getUsernameFromId(robloxId)
            const ep = await database.getCurrentEventPoints(robloxId) ?? 0
            const events = await database.getWeeklyEventIdsForUser(robloxId).catch(() => [])
            const eventCount = Array.isArray(events) ? events.length : 0

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle(`${robloxUsername}'s Event Points`)
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields(
                    { name: 'Events', value: String(eventCount), inline: true },
                    { name: 'EP', value: String(ep), inline: true }
                )

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get event points. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}