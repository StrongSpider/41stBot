'use strict'

const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js')
const { DISCORD_HICOM_ROLE_ID, DISCORD_OFFICER_ROLE_ID, DEVELOPER_DISCORD_USER_ID } = require('../../../config.json')
const { getIdFromUsername, getUsernameFromId } = require('../../api/roblox.js')
const { sendEventUpdateWebhook, sendEventDeleteWebhook } = require('../../api/webhook.js')
const database = require('../../api/database.js')

module.exports = {
    permission: 'HICOM',
    data: new SlashCommandBuilder()
        .setName('event-delete')
        .setDescription('Delete\'s a logged weekly event')
        .addStringOption(opt =>
            opt
                .setName('event-id')
                .setDescription('Event ID to delete')
                .setRequired(true)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const eventId = interaction.options.getString('event-id')
        const event = await database.getWeeklyEvent(eventId).catch(() => null)
        if (!event) return interaction.reply({ content: '<:warning:1297618648810393630> `Event not found.`', flags: MessageFlags.Ephemeral })

        const discordUserId = interaction.user.id

        const confirmButton = new ButtonBuilder()
            .setCustomId(`delete_event_button_${eventId}`)
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Danger)

        const row = new ActionRowBuilder().addComponents(confirmButton)

        await interaction.reply({ content: `Are you sure you want to delete [this event](${event.message || interaction.channel.url})? EP will not be changed.`, components: [row] })

        const message = await interaction.fetchReply()

        // Only the invoker can click the button. Collector times out after 60s.
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000,
            filter: i => i.customId === `delete_event_button_${eventId}` && i.user.id === discordUserId
        })

        collector.on('collect', async i => {
            await interaction.editReply({ content: "<a:loading:1439026179993767946> Removing event from the 41st database...", components: [] })

            try {
                await database.deleteEventById(eventId)

                // Audit webhook
                await sendEventDeleteWebhook({ eventId: eventId, changedBy: discordUserId })

                // Delete event message
                try {
                    if (event.message) {
                        // Extract channelId and messageId from jump URL
                        const parts = event.message.split('/')
                        const channelId = parts[parts.length - 2]
                        const messageId = parts[parts.length - 1]
    
                        const channel = await interaction.guild.channels.fetch(channelId)
    
                        const originalMessage = await channel.messages.fetch(messageId)
    
                        await originalMessage.delete()
                    }
                } catch {}
                
                await interaction.editReply({ content: "✅ **Event Removed Successfully**" })
            } catch {
                await interaction.editReply({ content: "<:warning:1297618648810393630> `Failed to delete event`", components: [] })
            }
        })

        collector.on('end', () => {
            interaction.editReply({ components: [] })
        })
    }
}