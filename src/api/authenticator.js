'use strict'

const { EventEmitter } = require('events')
const { randomInt } = require('crypto')

const database = require('./database.js')

const AUTH_WINDOW_MS = 120000 // 2 minutes
const TOKEN_WORDS = 7

// List of words used in authentication string
const WORD_LIST = [
    'luke', 'leia', 'han', 'chewie', 'yoda', 'obiwan', 'vader', 'darth',
    'jedi', 'sith', 'force', 'lightsaber', 'droid', 'clone', 'galaxy', 'tatooine'
]

// Shared event bus and in-memory state for active challenges
const AuthenticationEvent = new EventEmitter()
const ActiveAuthentications = new Map() // key: String(robloxId) -> { discordId, robloxId, token }

/**
 * Build a 7 word token using crypto randomness
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
    const timeoutEvent = 'EventEnded-' + key

    // Store challenge state
    ActiveAuthentications.set(key, { discordId: String(discord_id), robloxId: key, token: activationString })

    // Auto cancel when the window expires
    setTimeout(() => {
        if (!ActiveAuthentications.get(key)) return
        ActiveAuthentications.delete(key)
        AuthenticationEvent.emit(timeoutEvent)
    }, AUTH_WINDOW_MS)

    return { AuthenticationString: activationString, AuthenticationEvent }
}

/**
 * Confirm an authentication by checking whether the token is present
 * in the provided text (the Roblox bio)
 * @param {string|number} roblox_id Roblox user id
 * @param {string} activationString Text to search
 */
async function ConfirmAuthentication(roblox_id, activationString) {
    const key = keyOf(roblox_id)
    const auth = ActiveAuthentications.get(key)
    if (!auth) throw new Error('Authentication not found')

    const haystack = String(activationString || '')
    if (haystack.includes(auth.token)) {
        ActiveAuthentications.delete(key)
        await database.upsertRobloxId(auth.discordId, auth.robloxId)
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
