'use strict'

const DISCORD_MESSAGE_URL_REGEX = /^https?:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/i

/**
 * @param {string} input
 * @returns {string}
 */
function normalizeDiscordMessageUrl(input) {
    let value = String(input || '').trim()
    value = value.replace(/^<|>$/g, '')
    value = value.replace('discordapp.com', 'discord.com')
    value = value.replace(/^(https?:\/\/)(?:ptb\.|canary\.)?discord\.com/i, '$1discord.com')
    value = value.replace(/[?#].*$/g, '')
    value = value.replace(/\/+$/g, '')
    return value
}

/**
 * @param {string} messageUrl
 * @returns {{ url: string, guildId: string, channelId: string, messageId: string }|null}
 */
function parseDiscordMessageUrl(messageUrl) {
    const normalizedUrl = normalizeDiscordMessageUrl(messageUrl)
    const match = normalizedUrl.match(DISCORD_MESSAGE_URL_REGEX)
    if (!match) return null

    return {
        url: normalizedUrl,
        guildId: match[1],
        channelId: match[2],
        messageId: match[3]
    }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} messageUrl
 * @returns {Promise<import('discord.js').Message>}
 */
async function fetchGuildMessageByUrl(guild, messageUrl) {
    const parsed = parseDiscordMessageUrl(messageUrl)
    if (!parsed) {
        throw new Error('Invalid Discord message URL.')
    }

    const channel = await guild.channels.fetch(parsed.channelId)
    return channel.messages.fetch(parsed.messageId)
}

module.exports = {
    normalizeDiscordMessageUrl,
    parseDiscordMessageUrl,
    fetchGuildMessageByUrl
}
