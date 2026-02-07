'use strict'

const { SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { HICOM: DISCORD_HICOM_ROLE_ID, OFFICER: DISCORD_OFFICER_ROLE_ID } = config.DISCORD.ROLES
const { DEVELOPER_USER_ID: DEVELOPER_DISCORD_USER_ID } = config.DISCORD.BOT
const { getIdFromUsername, getUsernameFromId } = require('../../api/roblox.js')
const { sendEventUpdateWebhook } = require('../../api/webhook.js')
const database = require('../../api/database.js')

/**
 * Build the summary used in the original event message.
 * @param {{eventName:string, note:string, baseEpPoints:number, attendees:Array<{discordId:string}>, extraRecipients:Array<{discordId:string}>, supervisor:{discordId:string}|null, host:{discordId:string}}} data
 * @param {import('discord.js').Guild} guild
 */
function buildEventSummary({ eventName, note, baseEpPoints, attendees, extraRecipients, supervisor, host }, guild) {
    const lines = []
    lines.push(`Event: ${eventName}`)
    lines.push(`Host: <@${host.discordId}>`)
    if (supervisor) lines.push(`Supervisor: <@${supervisor.discordId}>`)

    // Remove host from attendees so the host is listed only once
    const filteredAttendees = attendees.filter(u => u.discordId !== host.discordId)

    // Partition attendees by officer role membership
    const officerAttendees = filteredAttendees.filter(u => {
        const member = guild.members.cache.get(u.discordId)
        return member && member.roles.cache.has(DISCORD_OFFICER_ROLE_ID)
    })
    const regularAttendees = filteredAttendees.filter(u => {
        const member = guild.members.cache.get(u.discordId)
        return !member || !member.roles.cache.has(DISCORD_OFFICER_ROLE_ID)
    })

    if (officerAttendees.length) {
        const offText = officerAttendees.map(u => `<@${u.discordId}>`).join(' ')
        lines.push(`Officers: ${offText}`)
    }
    if (regularAttendees.length) {
        const regText = regularAttendees.map(u => `<@${u.discordId}>`).join(' ')
        lines.push(`Attendees: ${regText}`)
    }

    if (extraRecipients.length) {
        const extraText = extraRecipients.map(u => `<@${u.discordId}>`).join(' ')
        lines.push(`Extra EP: ${extraText}`)
    }
    if (baseEpPoints > 1) lines.push(`Modifier: ${baseEpPoints}x EP`)
    if (note) lines.push(`Note: ${note}`)
    return lines.join('\n')
}

/**
 * Parse an existing summary message to recover note, base EP,
 * extra-recipient mentions, and base EP recipients.
 * @param {string} content
 * @returns {{ note:string, baseEpPoints:number, extraDiscordIds:string[], baseDiscordIds:string[] }}
 */
function parseOriginalSummaryContent(content) {
    const lines = content.split('\n')
    let note = ''
    let baseEpPoints = 1
    const extraDiscordIds = []
    const officers = []
    const attendees = []

    // Extract note, EP modifier, and extra EP lines
    for (const line of lines) {
        if (line.startsWith('Note: ')) {
            note = line.slice('Note: '.length)
        } else if (line.startsWith('Modifier: ')) {
            // Expect "Modifier: {n}x EP"
            const m = line.match(/Modifier: (\d+)x EP/)
            if (m) baseEpPoints = parseInt(m[1], 10)
        } else if (line.startsWith('Extra EP: ')) {
            const mentionRegex = /<@!?(\d+)>/g
            let mm
            const extraLine = line.slice('Extra EP: '.length)
            while ((mm = mentionRegex.exec(extraLine)) !== null) extraDiscordIds.push(mm[1])
        }
    }

    // Extract officer and attendee base EP recipients
    for (const line of lines) {
        if (line.startsWith('Officers: ')) {
            const rx = /<@!?(\d+)>/g
            let m
            const text = line.slice('Officers: '.length)
            while ((m = rx.exec(text)) !== null) officers.push(m[1])
        } else if (line.startsWith('Attendees: ')) {
            const rx = /<@!?(\d+)>/g
            let m
            const text = line.slice('Attendees: '.length)
            while ((m = rx.exec(text)) !== null) attendees.push(m[1])
        }
    }

    const baseDiscordIds = [...officers, ...attendees]
    return { note, baseEpPoints, extraDiscordIds, baseDiscordIds }
}

/**
 * Resolve a Roblox id from a username and ensure the user is verified.
 * Pushes a reason into errorList on failure.
 * @param {string} username
 * @param {string[]} errorList
 * @returns {Promise<number|null>}
 */
async function resolveVerifiedRobloxIdFromUsername(username, errorList) {
    try {
        const rid = await getIdFromUsername(username)
        const verifiedDiscord = await database.getDiscordIdByRoblox(rid)
        if (!verifiedDiscord) {
            errorList.push(`User \`${username}\` is not verified with the bot.`)
            return null
        }
        return rid
    } catch {
        errorList.push(`Username \`${username}\` not found`)
        return null
    }
}

/**
 * Map Roblox ids to current usernames, swallowing lookup failures.
 * @param {Array<string|number>} ids
 * @returns {Promise<string[]>}
 */
async function usernamesForIds(ids) {
    const out = []
    for (const id of ids) {
        try {
            const name = await getUsernameFromId(id)
            if (name) out.push(name)
        } catch { }
    }
    return out
}

module.exports = {
    permission: 'MINOR_OFFICER',
    data: new SlashCommandBuilder()
        .setName('event-edit')
        .setDescription('Edit a logged weekly event')
        .addStringOption(opt =>
            opt
                .setName('event-id')
                .setDescription('Event ID to edit')
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

        // Authorization: host or supervisor or HICOM/Developer only can edit
        const userRobloxId = await database.getRobloxIdByDiscord(discordUserId)
        const isHicom = interaction.member.roles.cache.has(DISCORD_HICOM_ROLE_ID) || interaction.user.id === DEVELOPER_DISCORD_USER_ID
        const isHost = event.host == userRobloxId
        const isSupervisor = event.supervisor == userRobloxId
        if (!(isHost || isSupervisor || isHicom)) {
            return interaction.reply({ content: 'You do not have permission to edit this event.', flags: MessageFlags.Ephemeral })
        }

        // Prefill modal values by resolving current usernames
        let hostUsername = ''
        if (event.host) {
            const hostDiscordId = await database.getDiscordIdByRoblox(event.host)
            if (hostDiscordId) hostUsername = await getUsernameFromId(event.host)
        }

        let supervisorUsername = ''
        if (event.supervisor && event.supervisor !== -1) {
            const supervisorDiscordId = await database.getDiscordIdByRoblox(event.supervisor)
            if (supervisorDiscordId) supervisorUsername = await getUsernameFromId(event.supervisor)
        }

        const attendeeUsernames = []
        for (const rid of event.attendees || []) {
            if (rid !== event.host && rid !== event.supervisor) {
                try {
                    const name = await getUsernameFromId(rid)
                    if (name) attendeeUsernames.push(name)
                } catch { }
            }
        }

        const attendeesStr = attendeeUsernames.join(' ')
        const hostStr = hostUsername || ''
        const supervisorStr = supervisorUsername || ''
        const typeStr = event.type || ''

        // Show an ephemeral Edit button which opens the modal when clicked
        const editButton = new ButtonBuilder()
            .setCustomId(`edit_event_button_${eventId}`)
            .setLabel('Edit')
            .setStyle(ButtonStyle.Secondary)

        const row = new ActionRowBuilder().addComponents(editButton)

        await interaction.reply({ content: `Event found: \`${eventId}\``, components: [row], flags: MessageFlags.Ephemeral })

        const message = await interaction.fetchReply()

        // Only the invoker can click the button. Collector times out after 60s.
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000,
            filter: i => i.customId === `edit_event_button_${eventId}` && i.user.id === discordUserId
        })

        collector.on('collect', async i => {
            const modal = new ModalBuilder()
                .setCustomId(`edit_event_modal_${eventId}`)
                .setTitle('Edit Event')

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('type_input')
                        .setLabel('Event Type')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(typeStr)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('host_input')
                        .setLabel('Host Roblox username')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(hostStr)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('supervisor_input')
                        .setLabel('Supervisor Roblox username')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setValue(supervisorStr)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('attendees_input')
                        .setLabel('Attendees (space-separated usernames)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setValue(attendeesStr)
                )
            )

            await i.showModal(modal)

            try {
                const submission = await i.awaitModalSubmit({
                    filter: m => m.customId === `edit_event_modal_${eventId}` && m.user.id === discordUserId,
                    time: 60000
                })

                if (submission.replied || submission.deferred) return

                await submission.deferUpdate()

                const newType = submission.fields.getTextInputValue('type_input')
                const newHostUsername = submission.fields.getTextInputValue('host_input')
                const newSupervisorUsername = submission.fields.getTextInputValue('supervisor_input')
                const newAttendeeUsernames = submission.fields.getTextInputValue('attendees_input').split(/\s+/).filter(Boolean)

                // Resolve usernames to verified Roblox ids
                const errorList = []

                let newHostId = null
                if (newHostUsername) newHostId = await resolveVerifiedRobloxIdFromUsername(newHostUsername, errorList)

                let newSupervisorId = -1
                if (newSupervisorUsername) {
                    const rid = await resolveVerifiedRobloxIdFromUsername(newSupervisorUsername, errorList)
                    if (rid !== null) newSupervisorId = rid
                }

                // Resolve attendees with dedupe and keeping input order
                const attendeeIds = []
                const seen = new Set()
                for (const uname of newAttendeeUsernames) {
                    const rid = await resolveVerifiedRobloxIdFromUsername(uname, errorList)
                    if (rid !== null && !seen.has(rid)) {
                        seen.add(rid)
                        attendeeIds.push(rid)
                    }
                }

                // Remove host/supervisor from attendees then re-add so base EP lists include them
                const filteredAttendeeIds = attendeeIds.filter(rid => rid !== newHostId && rid !== newSupervisorId)
                let finalAttendees = filteredAttendeeIds.slice()
                if (newHostId && !finalAttendees.includes(newHostId)) finalAttendees.push(newHostId)
                if (newSupervisorId && newSupervisorId !== -1 && !finalAttendees.includes(newSupervisorId)) finalAttendees.push(newSupervisorId)

                // If any resolution error happened, show all reasons and stop
                if (errorList.length) {
                    await submission.followUp({ content: `Errors:\n${errorList.join('\n')}`, flags: MessageFlags.Ephemeral })
                    await interaction.editReply({ components: [] })
                    return
                }

                // Change notes
                const changedUsers = []
                if (event.host !== newHostId) changedUsers.push(`Host changed from ${hostStr || 'none'} to ${newHostUsername}`)
                const prevSupStr = supervisorStr || 'none'
                const nextSupStr = newSupervisorUsername || 'none'
                if ((event.supervisor ?? -1) !== (newSupervisorId ?? -1)) changedUsers.push(`Supervisor changed from ${prevSupStr} to ${nextSupStr}`)

                // Compare attendees by usernames
                const oldSet = new Set((event.attendees || []).filter(rid => rid !== event.host && rid !== event.supervisor))
                const oldNames = await usernamesForIds([...oldSet])
                const newNameSet = new Set(newAttendeeUsernames)
                const removedAttendees = oldNames.filter(u => !newNameSet.has(u))
                const addedAttendees = newAttendeeUsernames.filter(u => !oldNames.includes(u))
                if (removedAttendees.length) changedUsers.push(`Attendees removed: ${removedAttendees.join(', ')}`)
                if (addedAttendees.length) changedUsers.push(`Attendees added: ${addedAttendees.join(', ')}`)

                // Granular DB change payload for webhook consumers
                const changesObj = {}
                if ((event.type || '') !== newType) changesObj.type = { from: event.type || '', to: newType }
                if (event.host !== newHostId) changesObj.host = { from: event.host, to: newHostId }
                const prevSup = event.supervisor ?? -1
                const nextSup = newSupervisorId ?? -1
                if (prevSup !== nextSup) changesObj.supervisor = { from: prevSup, to: nextSup }
                const oldAttArr = Array.isArray(event.attendees) ? event.attendees : []
                const newAttArr = Array.isArray(finalAttendees) ? finalAttendees : []
                const attendeesChanged = oldAttArr.length !== newAttArr.length || oldAttArr.some((id, idx) => id !== newAttArr[idx])
                if (attendeesChanged) changesObj.attendees = { from: oldAttArr, to: newAttArr }

                // Persist changes first
                await database.updateWeeklyEventPartial(eventId, { type: newType, host: newHostId, supervisor: newSupervisorId, attendees: finalAttendees })

                event.type = newType
                event.host = newHostId
                event.supervisor = newSupervisorId
                event.attendees = finalAttendees

                // Try editing the original event summary message (if we know its jump URL)
                let messageEditError = null
                if (event.message) {
                    try {
                        // Extract channelId and messageId from jump URL
                        const parts = event.message.split('/')
                        const channelId = parts[parts.length - 2]
                        const messageId = parts[parts.length - 1]

                        const channel = await interaction.guild.channels.fetch(channelId)
                        const originalMessage = await channel.messages.fetch(messageId)

                        // Recover note, base EP modifier, extra recipients, and original base EP recipients
                        const { note, baseEpPoints, extraDiscordIds, baseDiscordIds } = parseOriginalSummaryContent(originalMessage.content)

                        // Build new base EP list based on updated attendees
                        const newAttendeeDiscordIds = []
                        for (const rid of event.attendees || []) {
                            const dd = await database.getDiscordIdByRoblox(rid)
                            if (dd) newAttendeeDiscordIds.push(dd)
                        }

                        // Diff base EP recipients to increment or decrement points
                        const addedBaseIds = newAttendeeDiscordIds.filter(id => !baseDiscordIds.includes(id))
                        const removedBaseIds = baseDiscordIds.filter(id => !newAttendeeDiscordIds.includes(id))
                        const extraToRemove = extraDiscordIds.filter(id => removedBaseIds.includes(id))

                        // Only adjust EP when the original message had no components (plain summary post)
                        if (!originalMessage.components || originalMessage.components.length === 0) {
                            if (baseEpPoints && baseEpPoints > 0) {
                                for (const id of addedBaseIds) {
                                    const rid = await database.getRobloxIdByDiscord(id)
                                    if (rid) await database.incrementCurrentEventPoints(rid, baseEpPoints)
                                }
                                for (const id of removedBaseIds) {
                                    const rid = await database.getRobloxIdByDiscord(id)
                                    if (rid) await database.incrementCurrentEventPoints(rid, -baseEpPoints)
                                }
                            }
                            // Remove extra EP for users who lost base EP
                            for (const id of extraToRemove) {
                                const rid = await database.getRobloxIdByDiscord(id)
                                if (rid) await database.incrementCurrentEventPoints(rid, -1)
                            }
                        }

                        // Rebuild the summary text with updated IDs
                        const hostDiscordId = await database.getDiscordIdByRoblox(event.host)
                        const supDiscordId = event.supervisor && event.supervisor !== -1 ? await database.getDiscordIdByRoblox(event.supervisor) : null
                        const attendeeObjs = []
                        for (const rid of event.attendees || []) attendeeObjs.push({ discordId: await database.getDiscordIdByRoblox(rid) })

                        const updatedSummary = buildEventSummary({
                            eventName: event.type,
                            note,
                            baseEpPoints,
                            attendees: attendeeObjs,
                            extraRecipients: extraDiscordIds.map(id => ({ discordId: id })),
                            supervisor: supDiscordId ? { discordId: supDiscordId } : null,
                            host: { discordId: hostDiscordId }
                        }, interaction.guild)

                        await originalMessage.edit(updatedSummary)
                    } catch (err) {
                        messageEditError = err?.message || String(err)
                    }
                }

                // Audit webhook
                await sendEventUpdateWebhook({ eventId: eventId, changedBy: discordUserId, changes: changesObj })

                // Final private summary to the editor
                let followUpMessage = '**Event updated successfully!**'
                if (changedUsers.length) followUpMessage += `\n\n**Changes:**\n${changedUsers.join('\n')}`
                if (messageEditError) followUpMessage += `\n\n**Notice:** Failed to update event message: ${messageEditError}`

                await submission.followUp({ content: followUpMessage, flags: MessageFlags.Ephemeral })
                await interaction.editReply({ components: [] })
            } catch {
                await interaction.editReply({ components: [] })
            }
        })

        collector.on('end', () => {
            interaction.editReply({ components: [] })
        })
    }
}