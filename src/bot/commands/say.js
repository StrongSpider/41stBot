'use strict'

const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js')

module.exports = {
    permission: 'FFCNC',
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a message through the bot')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Select the channel to post in')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('input')
                .setDescription('Enter the message to send')
                .setRequired(true)
        ),
    /**
     * Execute the command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const channel = interaction.options.getChannel('channel')
            const input = interaction.options.getString('input')
            if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
                throw new Error('Selected channel cannot receive messages.')
            }

            await channel.send({ content: input })
            await interaction.reply({
                content: `Sent message in ${channel}.`,
                flags: MessageFlags.Ephemeral
            })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to send message. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
