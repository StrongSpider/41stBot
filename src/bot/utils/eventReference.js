'use strict'

const database = require('../../api/database')
const {
    normalizeDiscordMessageUrl,
    parseDiscordMessageUrl
} = require('./discordMessage.js')

const DISCORD_MESSAGE_URL_HINT_REGEX = /discord(?:app)?\.com\/channels\//i
const GENERIC_URL_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i

class EventReferenceError extends Error {
    /**
     * @param {string} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message)
        this.name = 'EventReferenceError'
        this.code = code
    }
}

/**
 * Normalize a Discord message jump link to the stored canonical form.
 * @param {string} input
 * @returns {string}
 */
function normalizeMessageUrl(input) {
    return normalizeDiscordMessageUrl(input)
}

/**
 * @param {string} input
 * @returns {boolean}
 */
function looksLikeDiscordMessageUrl(input) {
    const s = String(input || '').trim()
    return DISCORD_MESSAGE_URL_HINT_REGEX.test(s)
}

/**
 * Resolve either an event id or a Discord message jump link.
 * @param {string} input
 * @returns {Promise<{eventId: string, event: import('../../api/database/types.js').Event|null, source: 'event-id'|'message-url', reference: string}>}
 */
async function resolveEventReference(input) {
    const raw = String(input || '').trim()
    if (!raw) {
        throw new EventReferenceError('missing_reference', 'Missing event reference.')
    }

    if (looksLikeDiscordMessageUrl(raw)) {
        const parsedMessageUrl = parseDiscordMessageUrl(raw)
        if (!parsedMessageUrl) {
            throw new EventReferenceError(
                'invalid_message_url',
                'Please provide a full Discord message link in the form https://discord.com/channels/<guild>/<channel>/<message>.'
            )
        }

        const event = await database.findEventByMessage(parsedMessageUrl.url)
        if (!event) {
            throw new EventReferenceError(
                'message_not_indexed',
                'Could not find a logged event for that message link.'
            )
        }

        return {
            eventId: event.eventId,
            event,
            source: 'message-url',
            reference: parsedMessageUrl.url
        }
    }

    if (GENERIC_URL_REGEX.test(raw)) {
        throw new EventReferenceError(
            'unsupported_url',
            'This command accepts an event ID or a Discord message link.'
        )
    }

    return {
        eventId: raw,
        event: null,
        source: 'event-id',
        reference: raw
    }
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isEventReferenceError(err) {
    return err instanceof EventReferenceError || (Boolean(err) && err.name === 'EventReferenceError')
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function formatEventReferenceError(err) {
    if (!isEventReferenceError(err)) {
        return '<:warning:1297618648810393630> `Failed to resolve the event reference.`'
    }

    switch (err.code) {
        case 'missing_reference':
            return '<:warning:1297618648810393630> `Please provide an event ID or a Discord message link.`'
        case 'invalid_message_url':
            return '<:warning:1297618648810393630> `That message link is invalid. Paste a full Discord message link.`'
        case 'message_not_indexed':
            return '<:warning:1297618648810393630> `Could not find a logged event for that message link.`'
        case 'unsupported_url':
            return '<:warning:1297618648810393630> `This command accepts an event ID or a Discord message link.`'
        default:
            return '<:warning:1297618648810393630> `Failed to resolve the event reference.`'
    }
}

module.exports = {
    EventReferenceError,
    normalizeMessageUrl,
    resolveEventReference,
    isEventReferenceError,
    formatEventReferenceError
}
