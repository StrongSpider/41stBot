'use strict'

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js')
const { sendEventDeleteWebhook } = require('../../api/webhook.js')
const database = require('../../api/database.js')
const { fetchGuildMessageByUrl } = require('../utils/discordMessage.js')
const { formatEventEpLockMessage } = require('../utils/eventEpLock.js')
const {
    resolveEventReference,
    isEventReferenceError,
    formatEventReferenceError
} = require('../utils/eventReference.js')

module.exports = {
    permission: 'HICOM',
    requiresEventEpWrite: true,
    data: new SlashCommandBuilder()
        .setName('event-delete')
        .setDescription('Delete a logged weekly event')
        .addStringOption(opt =>
            opt
                .setName('event-id')
                .setDescription('Enter an event ID or log message link')
                .setRequired(true)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const lockState = await database.getEventEpLock()
        if (lockState && lockState.enabled) {
            return interaction.reply({ content: formatEventEpLockMessage(lockState), flags: MessageFlags.Ephemeral })
        }

        let eventId
        try {
            const eventReference = await resolveEventReference(interaction.options.getString('event-id', true))
            eventId = eventReference.eventId
        } catch (err) {
            if (isEventReferenceError(err)) {
                return interaction.reply({ content: formatEventReferenceError(err), flags: MessageFlags.Ephemeral })
            }
            throw err
        }

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
                await database.assertEventEpWriteUnlocked()
                await database.deleteEventById(eventId)

                // Audit webhook
                await sendEventDeleteWebhook({ eventId: eventId, changedBy: discordUserId })

                // Delete event message
                try {
                    if (event.message) {
                        const originalMessage = await fetchGuildMessageByUrl(interaction.guild, event.message)
                        await originalMessage.delete()
                    }
                } catch { }

                await interaction.editReply({ content: "✅ **Event Removed Successfully**" })
            } catch (err) {
                if (database.isEventEpLockError(err)) {
                    await interaction.editReply({ content: formatEventEpLockMessage(err.lockState), components: [] })
                    return
                }
                await interaction.editReply({ content: "<:warning:1297618648810393630> `Failed to delete event`", components: [] })
            }
        })

        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => { })
        })
    }
}
