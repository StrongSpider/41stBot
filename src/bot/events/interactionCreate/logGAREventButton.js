'use strict'

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    FileUploadBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} = require('discord.js')

const database = require('../../../api/database')
const { sendEventCreateWebhook } = require('../../../api/webhook.js')
const { formatEventEpLockMessage } = require('../../utils/eventEpLock.js')
const { buildEventSummary } = require('../../utils/eventSummary.js')

const BUTTON_CUSTOM_ID = 'log_gar_event'
const MODAL_CUSTOM_ID = 'log_gar_event_modal'
const EVENT_TYPE_CUSTOM_ID = 'gar_event_type'
const HOST_CUSTOM_ID = 'gar_event_host'
const ATTENDEES_CUSTOM_ID = 'gar_event_attendees'
const NOTE_CUSTOM_ID = 'gar_event_note'
const PROOF_CUSTOM_ID = 'gar_event_proof'
const MAX_SELECT_OPTIONS = 25
const MAX_ATTENDEES = 25

function createApprovalButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('confirm_minor')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('deny_minor')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary)
    )
}

function getGAREventTypes(eventTypes) {
    return Array.from(new Set(
        (eventTypes || [])
            .filter(eventType => typeof eventType === 'string' && eventType.includes('GAR '))
    )).slice(0, MAX_SELECT_OPTIONS)
}

function buildGAREventModal(eventTypes) {
    const eventTypeOptions = eventTypes.map(eventType => (
        new StringSelectMenuOptionBuilder()
            .setLabel(eventType.replace('GAR ', '').slice(0, 100) || eventType.slice(0, 100))
            .setValue(eventType)
    ))

    return new ModalBuilder()
        .setCustomId(MODAL_CUSTOM_ID)
        .setTitle('Log a GAR Event')
        .addLabelComponents(
            new LabelBuilder()
                .setLabel('Event type')
                .setDescription('Select the GAR event that you are logging')
                .setStringSelectMenuComponent(
                    new StringSelectMenuBuilder()
                        .setCustomId(EVENT_TYPE_CUSTOM_ID)
                        .setPlaceholder('Select a GAR event type')
                        .setMinValues(1)
                        .setMaxValues(1)
                        .addOptions(eventTypeOptions)
                ),
            new LabelBuilder()
                .setLabel('Host')
                .setDescription('Enter the name of the host')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId(HOST_CUSTOM_ID)
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Enter the host name')
                        .setMinLength(1)
                        .setMaxLength(100)
                        .setRequired(true)
                ),
            new LabelBuilder()
                .setLabel('Attendees')
                .setDescription('Select everyone who attended the event')
                .setUserSelectMenuComponent(
                    new UserSelectMenuBuilder()
                        .setCustomId(ATTENDEES_CUSTOM_ID)
                        .setPlaceholder('Select the attendees')
                        .setMinValues(1)
                        .setMaxValues(MAX_ATTENDEES)
                ),
            new LabelBuilder()
                .setLabel('Note')
                .setDescription('Add context for the event log')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId(NOTE_CUSTOM_ID)
                        .setStyle(TextInputStyle.Paragraph)
                        .setPlaceholder('Enter an optional note')
                        .setMaxLength(1000)
                        .setRequired(false)
                ),
            new LabelBuilder()
                .setLabel('Screenshot proof')
                .setDescription('Upload one image showing the event attendance')
                .setFileUploadComponent(
                    new FileUploadBuilder()
                        .setCustomId(PROOF_CUSTOM_ID)
                        .setMinValues(1)
                        .setMaxValues(1)
                        .setRequired(true)
                )
        )
}

function isImageAttachment(attachment) {
    const contentType = String(attachment?.contentType || '').toLowerCase()
    if (contentType) return contentType.startsWith('image/')

    const fileName = String(attachment?.name || '').toLowerCase()
    return /\.(?:avif|gif|jpe?g|png|webp)$/.test(fileName)
}

async function respondWithError(interaction, message) {
    const payload = { content: `<:warning:1297618648810393630> \`${message}\`` }
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload)
        return
    }
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
}

async function showGAREventModal(interaction) {
    const lockState = await database.getEventEpLock()
    if (lockState?.enabled) {
        await interaction.reply({
            content: formatEventEpLockMessage(lockState),
            flags: MessageFlags.Ephemeral
        })
        return
    }

    const eventTypes = getGAREventTypes(await database.getEventTypes())
    if (eventTypes.length === 0) {
        await respondWithError(interaction, 'No GAR event types are currently configured.')
        return
    }

    await interaction.showModal(buildGAREventModal(eventTypes))
}

async function resolveSelectedUsers(users) {
    return Promise.all(Array.from(users.values(), async user => ({
        discordId: user.id,
        robloxId: await database.getRobloxIdByDiscord(user.id)
    })))
}

async function submitGAREventModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    const lockState = await database.getEventEpLock()
    if (lockState?.enabled) {
        await interaction.editReply({ content: formatEventEpLockMessage(lockState) })
        return
    }

    const eventName = interaction.fields.getStringSelectValues(EVENT_TYPE_CUSTOM_ID)[0]
    const validEventTypes = getGAREventTypes(await database.getEventTypes())
    if (!eventName || !validEventTypes.includes(eventName)) {
        await respondWithError(interaction, 'That GAR event type is no longer available.')
        return
    }

    const displayHost = interaction.fields.getTextInputValue(HOST_CUSTOM_ID).trim()
    const note = interaction.fields.getTextInputValue(NOTE_CUSTOM_ID).trim()
    const selectedAttendees = interaction.fields.getSelectedUsers(ATTENDEES_CUSTOM_ID, true)
    const uploadedProofs = interaction.fields.getUploadedFiles(PROOF_CUSTOM_ID, true)
    const proof = uploadedProofs.first()

    if (!displayHost) {
        await respondWithError(interaction, 'Please enter a host name.')
        return
    }
    if (!proof || !isImageAttachment(proof)) {
        await respondWithError(interaction, 'Screenshot proof must be an image.')
        return
    }

    const attendeeUsers = new Map(selectedAttendees.map(user => [user.id, user]))
    attendeeUsers.set(interaction.user.id, interaction.user)

    const resolvedAttendees = await resolveSelectedUsers(attendeeUsers)
    const hostData = resolvedAttendees.find(user => user.discordId === interaction.user.id)

    if (!hostData?.robloxId) {
        await respondWithError(interaction, 'Your Discord account is not verified.')
        return
    }

    const unverifiedAttendees = resolvedAttendees.filter(user => !user.robloxId)
    if (unverifiedAttendees.length > 0) {
        await respondWithError(
            interaction,
            `These attendees are not verified: ${unverifiedAttendees.map(user => `<@${user.discordId}>`).join(', ')}`
        )
        return
    }

    const targetChannel = interaction.channel
    if (!targetChannel || typeof targetChannel.send !== 'function') {
        await respondWithError(interaction, 'The channel containing the GAR log button is unavailable.')
        return
    }

    await database.assertEventEpWriteUnlocked()

    const hostRobloxId = hostData.robloxId
    const summary = buildEventSummary({
        eventName: eventName.replace(/^GAR\s+/, ''),
        note,
        baseEpPoints: 1,
        attendees: resolvedAttendees,
        extraRecipients: [],
        supervisor: null,
        // The visible host is free text. This display-only host keeps the
        // logger in the attendee mentions consumed by the approval handler.
        host: { discordId: 'gar-display-host' }
    }, interaction.guild).replace(/^Host: .*$/m, `Host: ${displayHost}`) + "\nScreenshot:"

    const logMessage = await targetChannel.send({
        content: summary,
        components: [createApprovalButtons()],
        files: [{
            attachment: proof.url,
            name: proof.name || 'gar-event-proof.png',
            description: 'GAR event screenshot proof'
        }]
    })

    const timestamp = new Date().toISOString()
    const attendeeRobloxIds = resolvedAttendees.map(user => user.robloxId)
    const createdId = await database.createWeeklyEvent({
        type: eventName,
        host: hostRobloxId,
        supervisor: -1,
        attendees: attendeeRobloxIds,
        timestamp,
        message: logMessage.url
    })

    await sendEventCreateWebhook({
        eventId: createdId,
        type: eventName,
        host: hostRobloxId,
        supervisor: -1,
        attendees: attendeeRobloxIds,
        message: logMessage.url,
        timestamp
    })

    await interaction.editReply({
        content: `GAR event submitted for approval! Event ID:\n\`\`\`${createdId}\`\`\``
    })
}

/**
 * Handles both the button that opens the GAR event modal and the modal submission.
 * @param {import('discord.js').ButtonInteraction | import('discord.js').ModalSubmitInteraction} interaction
 */
module.exports = async function logGAREventButton(interaction) {
    const isButton = interaction?.isButton?.() && interaction.customId === BUTTON_CUSTOM_ID
    const isModalSubmit = interaction?.isModalSubmit?.() && interaction.customId === MODAL_CUSTOM_ID
    if (!isButton && !isModalSubmit) return

    try {
        if (isButton) {
            await showGAREventModal(interaction)
            return
        }

        await submitGAREventModal(interaction)
    } catch (error) {
        if (database.isEventEpLockError(error)) {
            try {
                const payload = { content: formatEventEpLockMessage(error.lockState) }
                if (interaction.deferred || interaction.replied) await interaction.editReply(payload)
                else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
            } catch { }
            return
        }

        const message = error?.message || 'Unknown error'
        try { await respondWithError(interaction, message) } catch { }
    }
}
