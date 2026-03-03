'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const {
    resolveEventReference,
    isEventReferenceError,
    formatEventReferenceError
} = require('../utils/eventReference.js')

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('event-id-from-message')
        .setDescription('Extract an event ID from a message URL')
        .addStringOption(option =>
            option
                .setName('message-url')
                .setDescription('Message URL with the event post')
                .setRequired(true)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            const raw = interaction.options.getString('message-url', true)
            const eventReference = await resolveEventReference(raw)
            const event = eventReference.event
            if (!event) throw new Error('Resolved message link without event data.')

            await interaction.editReply({
                content: `Event found! Event ID: \`${event.eventId}\``
            })
        } catch (err) {
            if (isEventReferenceError(err)) {
                await interaction.editReply({ content: formatEventReferenceError(err) }).catch(() => { })
                return
            }
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to resolve event id. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
