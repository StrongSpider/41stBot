'use strict'

const { MessageFlags } = require('discord.js')
const config = require('../../../../config.json')
const { OFFICER: DISCORD_OFFICER_ROLE_ID, FFCNC: DISCORD_FFCNC_ROLE_ID, ERT_OFFICER: DISCORD_ERT_OFFICER_ROLE_IDS } = config.DISCORD.ROLES
const { DEVELOPER_USER_ID: DEVELOPER_DISCORD_USER_ID } = config.DISCORD.BOT

const database = require('../../../api/database.js')
const webhook = require('../../../api/webhook.js')
const { formatEventEpLockMessage } = require('../../utils/eventEpLock.js')

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
        const event = await database.findEventByMessage(interaction.message?.url)
        if (!event) {
            await interaction.editReply({ content: '<:warning:1297618648810393630> `I could not find this event! Ask a HICOM+ to remove this.`', flags: MessageFlags.Ephemeral })
            return
        }

        // Permission gates
        const isDev = interaction.user?.id === DEVELOPER_DISCORD_USER_ID
        const isOfficer = Boolean(interaction.member?.roles?.cache?.has(DISCORD_OFFICER_ROLE_ID))

        if (event.type !== 'Counter Raid') {
            if (!isOfficer && !isDev) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You do not have sufficient permissions to approve this event!`', flags: MessageFlags.Ephemeral })
                return
            }
        } else {
            // Counter Raid requires ERT officer OR FFCNC OR Developer
            let ertOfficer = false
            if (Array.isArray(DISCORD_ERT_OFFICER_ROLE_IDS)) {
                for (const roleId of DISCORD_ERT_OFFICER_ROLE_IDS) {
                    if (interaction.member?.roles?.cache?.has(roleId)) {
                        ertOfficer = true
                        break
                    }
                }
            }
            const isFFcnc = Boolean(interaction.member?.roles?.cache?.has(DISCORD_FFCNC_ROLE_ID))
            if (!ertOfficer && !isFFcnc && !isDev) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You do not have sufficient permissions to approve this event!`', flags: MessageFlags.Ephemeral })
                return
            }
        }

        /** Extract all user ids from a mention list on a single line */
        const parseMentions = line => {
            if (!line || typeof line !== 'string') return []
            const matches = line.match(/<@!?([0-9]{17,20})>/g) || []
            return matches.map(m => m.replace(/[<@!>]/g, ''))
        }

        /** Parse a numeric modifier like `Modifier: 1.5` with sane defaults */
        const parseModifier = line => {
            if (!line || typeof line !== 'string') return 1
            const m = line.match(/modifier:\s*([0-9]+(?:\.[0-9]+)?)/i)
            if (!m) return 1
            const v = parseFloat(m[1])
            return Number.isFinite(v) && v > 0 ? v : 1
        }

        /** Ensure ids are unique and valid length */
        const uniqueIds = ids => Array.from(new Set((ids || []).filter(id => /^(?:[0-9]{17,20})$/.test(String(id)))))

        const raw = String(interaction.message?.content || '')
        const lines = raw.split('\n')

        // Find relevant lines case-insensitively
        const findLine = key => lines.find(l => l && l.toLowerCase().startsWith(key)) || ''
        const attendeesLine = findLine('attendees:')
        const officersLine = findLine('officers:')
        const extraEpLine = findLine('extra ep:')
        const modifierLine = findLine('modifier:')
        const hostLine = findLine('host:')
        const supervisorLine = findLine('supervisor:')

        // Build attendees from attendees + officers + host + supervisor
        let attendeeIds = []
        attendeeIds = attendeeIds.concat(parseMentions(attendeesLine))
        attendeeIds = attendeeIds.concat(parseMentions(officersLine))

        const hostId = parseMentions(hostLine)[0] || null
        const supervisorId = parseMentions(supervisorLine)[0] || null
        if (hostId) attendeeIds.push(hostId)
        if (supervisorId) attendeeIds.push(supervisorId)

        attendeeIds = uniqueIds(attendeeIds)

        // Extra recipients
        let extraRecipientIds = uniqueIds(parseMentions(extraEpLine))

        // Modifier math
        const baseEP = 1
        const effectiveEP = baseEP * parseModifier(modifierLine)

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
