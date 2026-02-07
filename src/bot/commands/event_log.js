'use strict'

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { OFFICER: DISCORD_OFFICER_ROLE_ID, MINOR_OFFICER: DISCORD_MINOR_OFFICER_ROLE_ID, HICOM: DISCORD_HICOM_ROLE_ID } = config.DISCORD.ROLES
const { CHANNELS: DISCORD_CHANNEL_IDS } = config.DISCORD
const { getIdFromUsername, getUsernameFromId } = require('../../api/roblox.js')
const { sendEventCreateWebhook } = require('../../api/webhook.js')
const database = require('../../api/database.js')
const Logger = require('../../api/logger.js')

// Note: Good luck! This command was a hacked together mess. I got AI to do a refactorization of it so hopefully its cleaner but, its AI code so who knows. - spiider

/**
 * Resolve a Roblox username to both IDs and mark an error on failure
 * @param {string} username
 * @param {string[]} errorList where human readable errors are pushed
 * @returns {Promise<{username:string, robloxId:number, discordId:string}|null>}
 */
async function resolveUserCredentials(username, errorList) {
    try {
        if (!username) return null
        const robloxId = await getIdFromUsername(username)
        const discordId = robloxId ? await database.getDiscordIdByRoblox(robloxId) : null
        if (!robloxId || !discordId) throw new Error('Resolution failed')
        return { username, robloxId, discordId }
    } catch {
        errorList.push(`\`${username}: user not verified\``)
        return null
    }
}

/**
 * Build the summary posted in officer channels and used for previews
 * @param {{ eventName:string, note:string, baseEpPoints:number, attendees:Array<{discordId:string}>, extraRecipients:Array<{discordId:string}>, supervisor:{discordId:string}|null, host:{discordId:string} }} data
 * @param {import('discord.js').Guild} guild
 */
function buildEventSummary({ eventName, note, baseEpPoints, attendees, extraRecipients, supervisor, host }, guild) {
    const lines = []
    lines.push(`Event: ${eventName}`)
    lines.push(`Host: <@${host.discordId}>`)
    if (supervisor) lines.push(`Supervisor: <@${supervisor.discordId}>`)

    // Remove host from attendees if present
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
 * Create the Confirm Edit Cancel action row
 * @param {boolean} disabled
 */
function createActionButtons(disabled = false) {
    const confirm = new ButtonBuilder()
        .setCustomId('confirm')
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    const edit = new ButtonBuilder()
        .setCustomId('edit')
        .setLabel('Edit')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    const cancel = new ButtonBuilder()
        .setCustomId('cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    return new ActionRowBuilder().addComponents(confirm, edit, cancel)
}

/**
 * Create the minor review confirm deny row
 */
function createMinorActionButtons() {
    const confirm = new ButtonBuilder()
        .setCustomId('confirm_minor')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Secondary)
    const deny = new ButtonBuilder()
        .setCustomId('deny_minor')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary)
    return new ActionRowBuilder().addComponents(confirm, deny)
}

/**
 * Debug timing helper for diagnostics
 * @param {string} label
 * @param {number} startTime
 */
function debugTiming(label, startTime) {
    const elapsed = Date.now() - startTime
    Logger.debug(`[event-log] ${label} +${elapsed}ms`)
}

module.exports = {
    permission: 'MINOR_OFFICER',
    data: new SlashCommandBuilder()
        .setName('event-log')
        .setDescription('Record an event and award EP')
        .addStringOption(option =>
            option
                .setName('event')
                .setDescription('Event name')
                .setAutocomplete(true)
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('attendees')
                .setDescription('Mentions of attendees')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('host')
                .setDescription('Host (defaults to you)')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('supervisor')
                .setDescription('Supervisor user')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option
                .setName('base-ep')
                .setDescription('Base EP points (1-3)')
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName('note')
                .setDescription('Optional note to include')
        ),
    /**
     * @param {import('discord.js').AutocompleteInteraction} interaction
     */
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true)
        const input = focused.value

        const term = String(input || '').toLowerCase()
        const matches = (await database.getEventTypes())
            .filter(e => !term || e.toLowerCase().startsWith(term))
            .slice(0, 5)
        const suggestions = matches.map(e => ({ name: e, value: e }))

        await interaction.respond(suggestions)
    },
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        if (!interaction.member) {
            interaction.reply({ content: '<:warning:1297618648810393630> `I couldn\'t find your account!`', flags: MessageFlags.Ephemeral })
            return
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        // Resolve role based target channel for publishing
        const hasMinor = interaction.member.roles.cache.has(DISCORD_MINOR_OFFICER_ROLE_ID)
        const hasOfficer = interaction.member.roles.cache.has(DISCORD_OFFICER_ROLE_ID)

        const officerChannelId = DISCORD_CHANNEL_IDS.OFFICER_EVENT_LOGS
        const minorChannelId = DISCORD_CHANNEL_IDS.MINOR_OFFICER_EVENT_LOGS

        let targetChannel = null
        if (hasOfficer) targetChannel = await interaction.guild.channels.fetch(officerChannelId)
        else if (hasMinor) targetChannel = await interaction.guild.channels.fetch(minorChannelId)

        const eventName = interaction.options.getString('event')
        const attendeesRaw = interaction.options.getString('attendees')

        let baseEpPoints = interaction.options.getInteger('base-ep') || 1


        if (baseEpPoints > 3) {
            if (!interaction.member?.roles?.cache?.has(DISCORD_HICOM_ROLE_ID) && interaction.user.id !== DEVELOPER_DISCORD_USER_ID) {
                baseEpPoints = 3
            }
        }

        const noteText = interaction.options.getString('note')

        // Extract mentioned user ids from the attendees string
        const attendeesIds = Array.from(attendeesRaw.matchAll(/<@!?(\d+)>/g), m => m[1])

        // Resolve Roblox ids for attendees, keep discord ids for mentions
        let resolvedAttendees = await Promise.all(
            attendeesIds.map(async id => {
                const rid = await database.getRobloxIdByDiscord(id)
                return { discordId: id, robloxId: rid }
            })
        )

        // Collect unverified attendees for the preview, then drop them from the working set
        const initialErrors = []
        resolvedAttendees.forEach(u => {
            if (!u.robloxId) initialErrors.push(`<@${u.discordId}>: \`user not verified\``)
        })
        resolvedAttendees = resolvedAttendees.filter(u => u.robloxId)

        // Select extra EP recipients or skip
        const extraMenu = new UserSelectMenuBuilder()
            .setCustomId('select_extra')
            .setPlaceholder('Select extra EP recipients (optional)')
            .setMinValues(0)
            .setMaxValues(25)
        const skipButton = new ButtonBuilder()
            .setCustomId('skip_extra')
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary)

        await interaction.editReply({
            content: 'Select any extra EP recipients, or press Skip:',
            components: [
                new ActionRowBuilder().addComponents(extraMenu),
                new ActionRowBuilder().addComponents(skipButton)
            ]
        })

        // Collect exactly one interaction from the invoker, timeout after 3 minutes
        const reply2 = await interaction.fetchReply()
        const extraCollector = reply2.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id && (i.customId === 'select_extra' || i.customId === 'skip_extra'),
            time: 180000,
            max: 1
        })

        const extraInteraction = await new Promise((resolve, reject) => {
            extraCollector.on('collect', i => resolve(i))
            extraCollector.on('end', collected => {
                if (collected.size === 0) reject(new Error('No extra EP interaction'))
            })
        }).catch(() => {
            interaction.editReply({ content: '<:warning:1297618648810393630> `No extra EP recipients selected or timed out. Click ‘Skip’ if there are none.`', components: [] })
            return null
        })

        if (!extraInteraction) return

        await extraInteraction.deferUpdate()

        // Resolve extra EP selections to ids. Use an empty array when Skip was clicked
        let resolvedExtra = []
        if (extraInteraction.customId === 'select_extra') {
            const selectedUsers = extraInteraction.users ? Array.from(extraInteraction.users.values()) : []
            resolvedExtra = await Promise.all(
                selectedUsers.map(async user => {
                    const rid = await database.getRobloxIdByDiscord(user.id)
                    return { discordId: user.id, robloxId: rid }
                })
            )
        }

        // Resolve host and supervisor from options
        const hostUser = interaction.options.getUser('host') || interaction.user
        const hostRobloxId = await database.getRobloxIdByDiscord(hostUser.id)
        if (hostRobloxId == null) {
            await interaction.editReply({ content: '<:warning:1297618648810393630> `Host user not verified!`', components: [] })
            return
        }
        let hostData = { discordId: hostUser.id, robloxId: hostRobloxId }

        let supervisorData = null
        const supUser = interaction.options.getUser('supervisor')
        if (supUser) {
            const supRid = await database.getRobloxIdByDiscord(supUser.id)
            if (supRid == null) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `Supervisor user not verified!`', components: [] })
                return
            }
            supervisorData = { discordId: supUser.id, robloxId: supRid }
        }

        if (baseEpPoints < 1) baseEpPoints = 1

        const summaryText = buildEventSummary({
            eventName,
            note: noteText,
            baseEpPoints,
            attendees: resolvedAttendees,
            extraRecipients: resolvedExtra,
            supervisor: supervisorData,
            host: hostData
        }, interaction.guild)

        // Keep mutable copies of the event data during the preview and edits
        let currentSummaryText = summaryText
        let currentResolvedAttendees = resolvedAttendees
        let currentResolvedExtra = resolvedExtra
        let currentHostData = hostData
        let currentResolvedSupervisor = supervisorData
        let currentBaseEpPoints = baseEpPoints

        let previewText = `**Event Preview:**\n${currentSummaryText}`
        if (initialErrors.length) previewText += `\n\n**Errors:**\n${initialErrors.join('\n')}`
        previewText += '\n\n**Use Edit to fix, then Confirm to publish.**'

        await interaction.editReply({
            content: previewText,
            components: [createActionButtons(false)]
        })

        const message = await interaction.fetchReply()

        let userActioned = false
        let locked = false

        // Restrict to the invoker and only accept our three button ids
        const collector = message.createMessageComponentCollector({
            filter: btn => btn.user.id === interaction.user.id && ['confirm', 'edit', 'cancel'].includes(btn.customId),
            time: 180000
        })

        collector.on('collect', async btn => {
            if (locked) {
                await btn.deferUpdate()
                return
            }

            const errorMessages = []

            // Ensure host and supervisor receive base EP by being in the attendees set
            if (currentResolvedSupervisor && !currentResolvedAttendees.find(u => u.discordId === currentResolvedSupervisor.discordId)) {
                currentResolvedAttendees.push(currentResolvedSupervisor)
            }
            if (currentHostData && !currentResolvedAttendees.find(u => u.discordId === currentHostData.discordId)) {
                currentResolvedAttendees.push(currentHostData)
            }

            if (btn.customId === 'confirm') {
                const timingStart = Date.now()
                Logger.debug(`[event-log] confirm start event="${eventName}" user=${interaction.user.id}`)

                locked = true
                await btn.deferUpdate()
                userActioned = true

                await interaction.editReply({ content: `<a:loading:1439026179993767946> Logging your event in the 41st database...`, components: [] })

                if (hasMinor && !hasOfficer) {
                    // Minor officer path. Send to review channel with confirm deny row
                    const msg = await targetChannel.send({
                        content: `${currentSummaryText}`,
                        components: [createMinorActionButtons()]
                    })

                    debugTiming('minor: review message sent', timingStart)

                    await interaction.editReply({ content: `Event sent for review to <#${minorChannelId}>.`, components: [] })

                    const robloxIds = currentResolvedAttendees.map(u => u.robloxId)
                    const supervisorId = currentResolvedSupervisor ? currentResolvedSupervisor.robloxId : -1

                    const createdId = await database.createWeeklyEvent({
                        type: eventName,
                        host: currentHostData.robloxId,
                        supervisor: supervisorId,
                        attendees: robloxIds,
                        timestamp: new Date().toISOString(),
                        message: msg.url
                    })

                    debugTiming(`minor: createWeeklyEvent complete (eventId=${createdId})`, timingStart)

                    await sendEventCreateWebhook({
                        eventId: createdId,
                        type: eventName,
                        host: currentHostData.robloxId,
                        supervisor: supervisorId,
                        attendees: robloxIds,
                        message: msg.url,
                        timestamp: new Date().toISOString()
                    })

                    debugTiming('minor: webhook sent and logging complete', timingStart)
                    return
                }

                // Officer path. Apply points immediately and publish
                const robloxIds = []
                for (const u of currentResolvedAttendees) {
                    if (!u.robloxId) {
                        errorMessages.push(`\`${u.discordId}: user not verified\``)
                        continue
                    }
                    robloxIds.push(u.robloxId)
                    await database.incrementCurrentEventPoints(u.robloxId, currentBaseEpPoints)
                }
                for (const u of currentResolvedExtra) {
                    if (!u.robloxId) {
                        errorMessages.push(`\`${u.discordId}: user not verified\``)
                        continue
                    }
                    await database.incrementCurrentEventPoints(u.robloxId, 1)
                }

                debugTiming('officer: EP increments complete', timingStart)

                const supervisorId = currentResolvedSupervisor ? currentResolvedSupervisor.robloxId : -1

                let officerMsg = null
                console.log(targetChannel)
                if (hasOfficer && targetChannel) {
                    officerMsg = await targetChannel.send({ content: `${currentSummaryText}` })
                    debugTiming('officer: officer channel message sent', timingStart)
                }

                const createdId = await database.createWeeklyEvent({
                    type: eventName,
                    host: currentHostData.robloxId,
                    supervisor: supervisorId,
                    attendees: robloxIds,
                    timestamp: new Date().toISOString(),
                    message: officerMsg ? officerMsg.url : undefined
                })

                debugTiming(`officer: createWeeklyEvent complete (eventId=${createdId})`, timingStart)

                await sendEventCreateWebhook({
                    eventId: createdId,
                    type: eventName,
                    host: currentHostData.robloxId,
                    supervisor: supervisorId,
                    attendees: robloxIds,
                    message: officerMsg ? officerMsg.url : undefined,
                    timestamp: new Date().toISOString()
                })

                debugTiming('officer: webhook sent and logging complete', timingStart)

                await interaction.editReply({ content: `Event confirmed & published! Event ID:\n\`\`\`${createdId}\`\`\``, components: [] })
                return
            }

            if (btn.customId === 'cancel') {
                locked = true
                userActioned = true
                return btn.update({ content: '`Event cancelled.`', components: [] })
            }

            if (btn.customId === 'edit') {
                // Resolve current identities to usernames for the modal fields
                const attendeeUsernames = await Promise.all(currentResolvedAttendees.map(async u => {
                    try {
                        return await getUsernameFromId(u.robloxId)
                    } catch {
                        errorMessages.push(`\`Roblox ID ${u.robloxId}: user not found\``)
                        return ''
                    }
                }))
                const extraUsernames = await Promise.all(currentResolvedExtra.map(async u => {
                    try {
                        return await getUsernameFromId(u.robloxId)
                    } catch {
                        errorMessages.push(`\`Roblox ID ${u.robloxId}: user not found\``)
                        return ''
                    }
                }))

                let hostUsername
                try {
                    hostUsername = await getUsernameFromId(currentHostData.robloxId)
                } catch {
                    errorMessages.push(`\`Roblox ID ${currentHostData.robloxId}: host not found\``)
                    hostUsername = ''
                }

                let supervisorUsername = ''
                if (currentResolvedSupervisor) {
                    try {
                        supervisorUsername = await getUsernameFromId(currentResolvedSupervisor.robloxId)
                    } catch {
                        errorMessages.push(`\`Roblox ID ${currentResolvedSupervisor.robloxId}: supervisor not found\``)
                        supervisorUsername = ''
                    }
                }

                // Build the edit modal with prefilled values
                const editModal = new ModalBuilder()
                    .setCustomId('edit_modal')
                    .setTitle('Edit Event Details')

                editModal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('attendees_input')
                            .setLabel('Attendees (space-separated)')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                            .setValue(attendeeUsernames.join(' '))
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('host_input')
                            .setLabel('Host username')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setValue(hostUsername)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('supervisor_input')
                            .setLabel('Supervisor username')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setValue(supervisorUsername)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('extra_input')
                            .setLabel('Extra EP recipients')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                            .setValue(extraUsernames.join(' '))
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('base_ep_input')
                            .setLabel('Base EP points')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setValue(String(currentBaseEpPoints))
                    )
                )

                await btn.showModal(editModal)

                // Wait for the matching modal submission from the same user
                let submission
                try {
                    submission = await interaction.awaitModalSubmit({
                        filter: m => m.customId === 'edit_modal' && m.user.id === interaction.user.id,
                        time: 180000
                    })
                } catch {
                    return
                }

                try {
                    await submission.deferUpdate()
                } catch { }


                // Extract updated values
                const updatedAttendees = submission.fields.getTextInputValue('attendees_input').split(/\s+/).filter(Boolean)
                const updatedHost = submission.fields.getTextInputValue('host_input') || hostUsername
                const updatedSupervisorStr = submission.fields.getTextInputValue('supervisor_input')
                const updatedExtra = submission.fields.getTextInputValue('extra_input').split(/\s+/).filter(Boolean)
                let updatedBase = parseInt(submission.fields.getTextInputValue('base_ep_input'), 10)
                if (isNaN(updatedBase) || updatedBase < 1) updatedBase = currentBaseEpPoints
                currentBaseEpPoints = updatedBase

                // Validate host and supervisor from usernames
                const candidateHost = await resolveUserCredentials(updatedHost, [])
                if (candidateHost) {
                    currentHostData = candidateHost
                } else {
                    errorMessages.push(`\`${updatedHost}: invalid host, keeping prior\``)
                }

                let resolvedSupervisor = currentResolvedSupervisor
                if (updatedSupervisorStr) {
                    const candidateSup = await resolveUserCredentials(updatedSupervisorStr, [])
                    if (candidateSup) resolvedSupervisor = candidateSup
                    else errorMessages.push(`\`${updatedSupervisorStr}: invalid supervisor, keeping prior\``)
                }

                // Re-resolve attendees and extra based on edited fields
                const allAtt = Array.from(new Set([...updatedAttendees, currentHostData.username]))
                const freshResolvedAttendees = (await Promise.all(allAtt.map(u => resolveUserCredentials(u, errorMessages)))).filter(u => u)
                const freshResolvedExtra = (await Promise.all(updatedExtra.map(u => resolveUserCredentials(u, errorMessages)))).filter(u => u)

                // Drop any unverified from the working lists
                const safeResolvedAttendees = freshResolvedAttendees.filter(u => u.robloxId)
                const safeResolvedExtra = freshResolvedExtra.filter(u => u.robloxId)

                // Rebuild the preview summary
                const newSummary = buildEventSummary({
                    eventName,
                    note: noteText,
                    baseEpPoints: currentBaseEpPoints,
                    attendees: safeResolvedAttendees,
                    extraRecipients: safeResolvedExtra,
                    supervisor: resolvedSupervisor,
                    host: currentHostData
                }, interaction.guild)

                // Update current working state
                currentSummaryText = newSummary
                currentResolvedAttendees = safeResolvedAttendees
                currentResolvedExtra = safeResolvedExtra
                currentResolvedSupervisor = resolvedSupervisor

                let updateText = `**Event Preview:**\n${newSummary}`
                if (errorMessages.length) updateText += `\n\n**Errors:**\n${errorMessages.join('\n')}`
                updateText += '\n\n**Use Edit then Confirm.**'
                await btn.editReply({ content: updateText, components: [createActionButtons(false)] })
            }
        })

        collector.on('end', async () => {
            if (!userActioned) await interaction.editReply({ components: [createActionButtons(true)] })
        })
    }
}