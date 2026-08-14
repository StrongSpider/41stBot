'use strict'

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const config = require('../../../../config.json')

const LoggerClass = require('../../../api/logger.js')
const logger = new LoggerClass('GAREventLogMessage', 'BOT')

const GAR_EVENT_LOG_CHANNEL_ID = config.DISCORD.CHANNELS?.GAR_EVENT_LOGS
const BUTTON_CUSTOM_ID = 'log_gar_event'
const PROMPT_CONTENT = '## Click the button below to begin logging a GAR Event'

let repositionQueue = Promise.resolve()

function createLogEventButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(BUTTON_CUSTOM_ID)
            .setLabel('Log GAR Event')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📝')
    )
}

function hasLogEventButton(message) {
    return Boolean(message?.components?.some(row => (
        row.components?.some(component => (
            component.customId === BUTTON_CUSTOM_ID || component.data?.custom_id === BUTTON_CUSTOM_ID
        ))
    )))
}

function getMessages(collection) {
    if (!collection) return []
    if (typeof collection.values === 'function') return Array.from(collection.values())
    return Array.isArray(collection) ? collection : []
}

async function repositionPrompt(message) {
    const channel = message.channel
    if (!channel || typeof channel.send !== 'function') return

    let priorPrompts = []
    if (typeof channel.messages?.fetch === 'function') {
        try {
            const recentMessages = await channel.messages.fetch({ limit: 100 })
            const botUserId = message.client?.user?.id
            priorPrompts = getMessages(recentMessages).filter(candidate => (
                candidate.id !== message.id &&
                hasLogEventButton(candidate) &&
                (!botUserId || candidate.author?.id === botUserId)
            ))
        } catch (error) {
            logger.warn(`Failed to find the old GAR event-log prompt: ${error?.message || error}`)
        }
    }

    await channel.send({
        content: PROMPT_CONTENT,
        components: [createLogEventButtonRow()]
    })

    await Promise.all(priorPrompts.map(async prompt => {
        try {
            await prompt.delete()
        } catch (error) {
            logger.warn(`Failed to remove an old GAR event-log prompt: ${error?.message || error}`)
        }
    }))
}

/**
 * Keeps the GAR event-log prompt below every other message in its channel.
 * @param {import('discord.js').Message} message
 */
module.exports = async function GAREventLogMessage(message) {
    if (!message || message.channelId !== GAR_EVENT_LOG_CHANNEL_ID) return

    // The replacement prompt also emits messageCreate. Do not replace it again.
    if (hasLogEventButton(message)) return

    const queuedReposition = repositionQueue
        .catch(() => { })
        .then(() => repositionPrompt(message))

    repositionQueue = queuedReposition

    try {
        await queuedReposition
    } catch (error) {
        logger.error(`Failed to reposition the GAR event-log prompt: ${error?.message || error}`)
    }
}
