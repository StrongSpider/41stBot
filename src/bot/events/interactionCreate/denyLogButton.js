'use strict'

const { MessageFlags } = require('discord.js')

const database = require('../../../api/database')
const webhook = require('../../../api/webhook.js')
const { formatEventEpLockMessage } = require('../../utils/eventEpLock.js')
const {
    MINOR_REVIEW_EVENT_NOT_FOUND_MESSAGE,
    findMinorReviewEvent,
    canManageMinorReviewEvent,
    getMinorReviewPermissionError
} = require('../../utils/minorEventReview.js')

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
module.exports = async function denyLogButton(interaction) {
    try {
        if (!interaction?.isButton?.()) return
        if (interaction.customId !== 'deny_minor') return

        // Always reply privately for moderation actions
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        const lockState = await database.getEventEpLock()
        if (lockState && lockState.enabled) {
            await interaction.editReply({ content: formatEventEpLockMessage(lockState), flags: MessageFlags.Ephemeral })
            return
        }

        // Look up the logged event by the source message URL
        const event = await findMinorReviewEvent(interaction)
        if (!event) {
            await interaction.editReply({ content: MINOR_REVIEW_EVENT_NOT_FOUND_MESSAGE, flags: MessageFlags.Ephemeral })
            return
        }

        if (!canManageMinorReviewEvent(interaction, event)) {
            await interaction.editReply({ content: getMinorReviewPermissionError('deny'), flags: MessageFlags.Ephemeral })
            return
        }

        try {
            const raw = String(interaction.message?.content || '')

            await database.assertEventEpWriteUnlocked()
            // Remove the event from storage
            await database.deleteEventById(event.eventId)

            try {
                await database.incrementMinorOfficerReviewerCount(interaction.user.id)
            } catch { }

            // Remove the buttons and then delete the message to avoid re-clicks
            try { await interaction.message.edit({ content: raw, components: [] }) } catch { }
            try { await interaction.message.delete() } catch { }

            // Webhook audit
            try {
                await webhook.sendEventDeleteWebhook({ eventId: event.eventId, changedBy: interaction.user.id })
            } catch { }

            // Notify host via DM if possible
            try {
                const hostDiscordId = await database.getDiscordIdByRoblox(event.host)
                if (hostDiscordId) {
                    const hostUser = await interaction.client.users.fetch(hostDiscordId).catch(() => null)
                    if (hostUser) await hostUser.send('Your **' + event.type + '** has been `denied` by <@' + interaction.user.id + '>.')
                }
            } catch { }

            await interaction.editReply({ content: 'Deleted Event: `' + String(event.eventId) + '`', flags: MessageFlags.Ephemeral })
        } catch (e) {
            if (database.isEventEpLockError(e)) {
                await interaction.editReply({ content: formatEventEpLockMessage(e.lockState), flags: MessageFlags.Ephemeral })
                return
            }
            const msg = e && e.message ? e.message : 'Unknown error'
            await interaction.editReply({ content: '<:warning:1297618648810393630> `' + msg + '`', flags: MessageFlags.Ephemeral })
        }
    } catch (e) {
        if (database.isEventEpLockError(e)) {
            try { await interaction.editReply({ content: formatEventEpLockMessage(e.lockState), flags: MessageFlags.Ephemeral }) } catch { }
            return
        }
        const msg = e && e.message ? e.message : 'Unknown error'
        try { await interaction.editReply({ content: '<:warning:1297618648810393630> `' + msg + '`', flags: MessageFlags.Ephemeral }) } catch { }
    }
}
