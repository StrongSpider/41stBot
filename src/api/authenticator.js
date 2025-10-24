'use strict'

const { EventEmitter } = require('events')
const { randomInt } = require('crypto')

const database = require('./database.js')

/**
 * Authenticator
 *
 * Starts and confirms short-lived verification challenges used to link a
 * Discord user to a Roblox account. The user places a generated phrase in
 * their Roblox bio, then we scan the bio and confirm when it contains the
 * phrase.
 *
 * Events emitted on the shared emitter:
 *  - `UserAuthenticated-<robloxId>` when the bio check passes
 *  - `EventEnded-<robloxId>` when the challenge window expires
 *
 * Notes
 *  - Plain ASCII only, no semicolons
 *  - Uses a shared EventEmitter so callers can subscribe once per flow
 */

// ----------------------------------------
// Constants
// ----------------------------------------
const AUTH_WINDOW_MS = 120000 // 2 minutes
const TOKEN_WORDS = 7

// Keep the word list simple and memorable
const WORD_LIST = [
    'luke', 'leia', 'han', 'chewie', 'yoda', 'obiwan', 'vader', 'darth',
    'jedi', 'sith', 'force', 'lightsaber', 'droid', 'clone', 'galaxy', 'tatooine'
]

// Shared event bus and in-memory state for active challenges
const AuthenticationEvent = new EventEmitter()
const ActiveAuthentications = new Map() // key: String(robloxId) -> { discordId, robloxId, token }

/**
 * Build a 7 word token using crypto grade randomness
 */
function makeToken() {
    const words = []
    for (let i = 0; i < TOKEN_WORDS; i++) {
        words.push(WORD_LIST[randomInt(WORD_LIST.length)])
    }
    return words.join(' ')
}

function keyOf(robloxId) {
    return String(robloxId)
}

/**
 * Start an authentication flow for a given user pair
 * @param {string} discord_id Discord user id
 * @param {string|number} roblox_id Roblox user id
 * @returns {{ AuthenticationString: string, AuthenticationEvent: import('events').EventEmitter }}
 */
async function StartAuthentication(discord_id, roblox_id) {
    const key = keyOf(roblox_id)

    if (ActiveAuthentications.get(key)) throw new Error('Authentication already started')

    const activationString = makeToken()

    const successEvent = 'UserAuthenticated-' + key
    const timeoutEvent = 'EventEnded-' + key

    // Store challenge state
    ActiveAuthentications.set(key, { discordId: String(discord_id), robloxId: key, token: activationString })

    // One time success handler
    AuthenticationEvent.once(successEvent, () => {
        ActiveAuthentications.delete(key)
        // Persist the link, best effort
        try { database.upsertRobloxId(discord_id, roblox_id) } catch { }
        // Clean up any stale listeners for safety
        AuthenticationEvent.removeAllListeners(successEvent)
    })

    // Auto cancel when the window expires
    setTimeout(() => {
        if (!ActiveAuthentications.get(key)) return
        ActiveAuthentications.delete(key)
        AuthenticationEvent.emit(timeoutEvent)
        AuthenticationEvent.removeAllListeners(successEvent)
    }, AUTH_WINDOW_MS)

    return { AuthenticationString: activationString, AuthenticationEvent }
}

/**
 * Confirm an authentication by checking whether the token is present
 * in the provided text (the Roblox bio)
 * @param {string|number} roblox_id Roblox user id
 * @param {string} activationString Text to search, usually the Roblox bio
 */
async function ConfirmAuthentication(roblox_id, activationString) {
    const key = keyOf(roblox_id)
    const auth = ActiveAuthentications.get(key)
    if (!auth) throw new Error('Authentication not found')

    const haystack = String(activationString || '')
    if (haystack.includes(auth.token)) {
        AuthenticationEvent.emit('UserAuthenticated-' + key)
    } else {
        ActiveAuthentications.delete(key)
        AuthenticationEvent.removeAllListeners('UserAuthenticated-' + key)
        throw new Error('Authentication string did not match')
    }
}

module.exports = {
    StartAuthentication,
    ConfirmAuthentication
}