'use strict'

const { MessageFlags } = require('discord.js')
const { DISCORD_OFFICER_ROLE_ID, DISCORD_FFCNC_ROLE_ID, DISCORD_ERT_OFFICER_ROLE_IDS, DEVELOPER_DISCORD_USER_ID } = require('../../../../config.json')

const database = require('../../../api/database.js')
const webhook = require('../../../api/webhook.js')

module.exports = async function denyLogButton(interaction) {
    try {
        if (!interaction?.isButton?.()) return
        if (interaction.customId !== 'deny_minor') return

        // Always reply privately for moderation actions
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

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
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You do not have sufficient permissions to deny this event!`', flags: MessageFlags.Ephemeral })
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
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You do not have sufficient permissions to deny this event!`', flags: MessageFlags.Ephemeral })
                return
            }
        }

        try {
            // Remove the event from storage
            await database.deleteEventById(event.eventid)

            // Remove the buttons and then delete the message to avoid re-clicks
            try { await interaction.message.edit({ content: interaction.message?.content || '', components: [] }) } catch { }
            try { await interaction.message.delete() } catch { }

            // Webhook audit
            try {
                await webhook.sendEventDeleteWebhook({ eventid: event.eventid, changedBy: interaction.user.id })
            } catch { }

            // Notify host via DM if possible
            try {
                const hostDiscordId = await database.getDiscordIdByRoblox(event.host)
                if (hostDiscordId) {
                    const hostUser = await interaction.client.users.fetch(hostDiscordId).catch(() => null)
                    if (hostUser) await hostUser.send('Your **' + event.type + '** has been `denied` by <@' + interaction.user.id + '>.')
                }
            } catch { }

            await interaction.editReply({ content: 'Deleted Event: `' + String(event.eventid) + '`', flags: MessageFlags.Ephemeral })
        } catch (e) {
            const msg = e && e.message ? e.message : 'Unknown error'
            await interaction.editReply({ content: '<:warning:1297618648810393630> `' + msg + '`', flags: MessageFlags.Ephemeral })
        }
    } catch (e) {
        const msg = e && e.message ? e.message : 'Unknown error'
        try { await interaction.editReply({ content: '<:warning:1297618648810393630> `' + msg + '`', flags: MessageFlags.Ephemeral }) } catch { }
    }
}