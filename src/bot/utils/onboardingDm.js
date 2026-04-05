'use strict'

const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js')
const config = require('../../../config.json')

const { EMBED_COLOR } = config.GENERAL

/**
 * @param {{ AuthenticationUrl?: string, ExpiresAt?: number|string|Date }} auth
 * @param {{ thumbnailUrl?: string|null }} [options]
 * @returns {{ embeds: import('discord.js').EmbedBuilder[], components: import('discord.js').ActionRowBuilder<import('discord.js').ButtonBuilder>[] }}
 */
function buildOnboardingDmPayload(auth, options = {}) {
    const authenticationUrl = String(auth?.AuthenticationUrl || '').trim()
    if (!authenticationUrl) {
        throw new Error('AuthenticationUrl is required to build the onboarding DM.')
    }

    const thumbnailUrl = String(options?.thumbnailUrl || '').trim()

    const expiresAtUnix = Math.max(
        Math.floor(Date.now() / 1000),
        Math.floor(Number(auth?.ExpiresAt || Date.now()) / 1000)
    )

    const verifyButton = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(authenticationUrl)
        .setLabel('Verify with Roblox')

    const row = new ActionRowBuilder().addComponents(verifyButton)

    const dmEmbed = new EmbedBuilder()
        .setTitle('Verify Your Account')
        .setDescription("Click the button below to link your Roblox account with 41st's database.")
        .setColor(EMBED_COLOR)
        .setTimestamp()
        .addFields(
            { name: 'Expires', value: `<t:${expiresAtUnix}:R> (<t:${expiresAtUnix}:f>)` },
            { name: 'Need a new link?', value: 'Run `/verify start` in the server at any time.' }
        )

    if (thumbnailUrl) {
        dmEmbed.setThumbnail(thumbnailUrl)
    }

    return {
        embeds: [dmEmbed],
        components: [row]
    }
}

module.exports = {
    buildOnboardingDmPayload
}
