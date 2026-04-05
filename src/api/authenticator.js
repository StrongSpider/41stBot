'use strict'

const crypto = require('crypto')
const config = require('../../config.json')

const AUTH_WINDOW_MS = 10 * 60 * 1000
const TOKEN_TYPE = 'roblox_oauth_verify'

function getSigningSecret() {
    const secret = String(config.PORTAL?.SECRET || '').trim()
    if (!secret) throw new Error('Verification signing secret is not configured.')
    return secret
}

function getOAuthStartUrlBase() {
    const redirectUri = String(config.ROBLOX?.OAUTH?.REDIRECT_URI || '').trim()
    if (!redirectUri) throw new Error('ROBLOX.OAUTH.REDIRECT_URI is not configured.')

    let parsed
    try {
        parsed = new URL(redirectUri)
    } catch (_) {
        throw new Error('ROBLOX.OAUTH.REDIRECT_URI is invalid.')
    }

    return `${parsed.origin}/auth/roblox`
}

function encodeSegment(value) {
    return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeSegment(value) {
    return Buffer.from(value, 'base64url').toString('utf8')
}

function signPayload(encodedPayload) {
    return crypto
        .createHmac('sha256', getSigningSecret())
        .update(encodedPayload)
        .digest('base64url')
}

function safeDiscordId(discordId) {
    const value = String(discordId || '').trim()
    if (!/^\d{5,30}$/.test(value)) throw new Error('Invalid Discord user id.')
    return value
}

function verifyAuthenticationToken(token) {
    const raw = String(token || '').trim()
    if (!raw) throw new Error('Missing verification token.')

    const parts = raw.split('.')
    if (parts.length !== 2) throw new Error('Invalid verification token.')

    const [encodedPayload, signature] = parts
    const expectedSignature = signPayload(encodedPayload)
    const expectedBuffer = Buffer.from(expectedSignature)
    const actualBuffer = Buffer.from(signature)

    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        throw new Error('Invalid verification token signature.')
    }

    let payload
    try {
        payload = JSON.parse(decodeSegment(encodedPayload))
    } catch (_) {
        throw new Error('Invalid verification token payload.')
    }

    if (payload?.type !== TOKEN_TYPE) throw new Error('Invalid verification token type.')
    if (!payload?.discordId) throw new Error('Verification token is missing Discord user id.')
    if (!payload?.exp || Number(payload.exp) < Date.now()) throw new Error('Verification link expired. Please run /verify start again.')

    return {
        type: payload.type,
        discordId: safeDiscordId(payload.discordId),
        iat: Number(payload.iat || 0),
        exp: Number(payload.exp),
        nonce: String(payload.nonce || '')
    }
}

async function StartAuthentication(discordId) {
    const now = Date.now()
    const payload = {
        type: TOKEN_TYPE,
        discordId: safeDiscordId(discordId),
        iat: now,
        exp: now + AUTH_WINDOW_MS,
        nonce: crypto.randomBytes(16).toString('hex')
    }

    const encodedPayload = encodeSegment(JSON.stringify(payload))
    const signature = signPayload(encodedPayload)
    const token = `${encodedPayload}.${signature}`
    const baseUrl = getOAuthStartUrlBase()

    return {
        AuthenticationUrl: `${baseUrl}?verify=${encodeURIComponent(token)}`,
        ExpiresAt: payload.exp
    }
}

module.exports = {
    AUTH_WINDOW_MS,
    StartAuthentication,
    verifyAuthenticationToken
}
