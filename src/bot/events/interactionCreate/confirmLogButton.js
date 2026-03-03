'use strict'

const { MessageFlags } = require('discord.js')

const database = require('../../../api/database.js')
const webhook = require('../../../api/webhook.js')
const { formatEventEpLockMessage } = require('../../utils/eventEpLock.js')
const {
    MINOR_REVIEW_EVENT_NOT_FOUND_MESSAGE,
    findMinorReviewEvent,
    canManageMinorReviewEvent,
    getMinorReviewPermissionError
} = require('../../utils/minorEventReview.js')
const { parseEventSummaryContent } = require('../../utils/eventSummary.js')

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
module.exports = async function confirmLogButton(interaction) {
    try {
        if (!interaction?.isButton?.()) return
        if (interaction.customId !== 'confirm_minor') return

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
            await interaction.editReply({ content: getMinorReviewPermissionError('approve'), flags: MessageFlags.Ephemeral })
            return
        }

        const raw = String(interaction.message?.content || '')
        const {
            hostDiscordId: hostId,
            baseDiscordIds: attendeeIds,
            extraDiscordIds: extraRecipientIds,
            baseEpPoints: effectiveEP
        } = parseEventSummaryContent(raw)

        // Increment EP for attendees
        await database.assertEventEpWriteUnlocked()
        for (const uid of attendeeIds) {
            try {
                const robloxId = await database.getRobloxIdByDiscord(uid)
                if (robloxId) await database.incrementCurrentEventPoints(robloxId, effectiveEP)
            } catch { }
        }

        // Increment EP for extra recipients (by 1)
        for (const uid of extraRecipientIds) {
            try {
                const robloxId = await database.getRobloxIdByDiscord(uid)
                if (robloxId) await database.incrementCurrentEventPoints(robloxId, 1)
            } catch { }
        }

        // Remove buttons to prevent double approvals, keep content unchanged
        try { await interaction.message.edit({ content: raw, components: [] }) } catch { }

        // Webhook audit
        try { await webhook.sendMinorLogged(interaction.user.id, interaction.message?.url) } catch { }

        // Build summary
        const summary = []
        if (attendeeIds.length) summary.push('Incremented ' + String(effectiveEP) + ' EP for attendees: ' + attendeeIds.map(id => '<@' + id + '>').join(', '))
        if (extraRecipientIds.length) summary.push('Incremented 1 EP for extra recipients: ' + extraRecipientIds.map(id => '<@' + id + '>').join(', '))
        if (summary.length === 0) summary.push('No attendees or extra recipients found to update.')

        await interaction.editReply({ content: summary.join('\n'), flags: MessageFlags.Ephemeral })

        // Notify host via DM if present
        if (hostId) {
            try {
                const hostUser = await interaction.client.users.fetch(hostId)
                if (hostUser) await hostUser.send('Your ' + event.type + ' has been `approved` by <@' + interaction.user.id + '>.')
            } catch { }
        }
    } catch (e) {
        if (database.isEventEpLockError(e)) {
            try {
                await interaction.editReply({ content: formatEventEpLockMessage(e.lockState), flags: MessageFlags.Ephemeral })
            } catch { }
            return
        }
        const msg = e && e.message ? e.message : 'Unknown error'
        try {
            await interaction.editReply({ content: '<:warning:1297618648810393630> `' + msg + '`', flags: MessageFlags.Ephemeral })
        } catch { }
    }
}
