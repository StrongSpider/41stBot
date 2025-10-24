'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')

/**
 * /event-id-from-message
 *
 * Extract the event id associated with a Discord message URL that points to
 * a previously logged event. The lookup is performed against the canonical
 * jump URL format the bot stores.
 *
 * Behavior
 *  - Normalizes common Discord URL variants to `https://discord.com/...`
 *  - Replies ephemerally for privacy using MessageFlags.Ephemeral
 *  - Provides a clear warning if no event is found
 *
 * @file event_id_from_message.js
 */

/**
 * Normalize a message URL into the canonical jump URL used by Discord
 * Examples handled
 *  - discordapp.com -> discord.com
 *  - ptb.discord.com / canary.discord.com -> discord.com
 *  - trims surrounding angle brackets from chat paste
 *  - strips trailing slashes
 * @param {string} input
 * @returns {string}
 */
function normalizeMessageUrl(input) {
    let s = String(input || '').trim()
    // remove surrounding angle brackets like <https://...>
    s = s.replace(/^<|>$/g, '')
    // standardize host variants
    s = s.replace('discordapp.com', 'discord.com')
    s = s.replace(/^(https?:\/\/)(?:ptb\.|canary\.)?discord\.com/i, '$1discord.com')
    // remove trailing slash if present
    s = s.replace(/\/+$/g, '')
    return s
}

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('event-id-from-message')
        .setDescription('Extract an event ID from a message URL')
        .addStringOption(option =>
            option
                .setName('message-url')
                .setDescription('Message URL with the event post')
                .setRequired(true)
        ),
    /**
     * Execute the command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            const raw = interaction.options.getString('message-url', true)
            const messageUrl = normalizeMessageUrl(raw)

            // Optional: sanity check format, but still attempt lookup even if it fails
            const looksLikeJump = /^https?:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(messageUrl)

            const event = await database.findEventByMessage(messageUrl)
            if (!event) {
                const hint = looksLikeJump ? '' : '\n`Tip: paste a full message jump link from Discord (Right click > Copy Message Link).`'
                await interaction.editReply({
                    content: '<:warning:1297618648810393630> `Could not find an event for this message!`' + hint
                })
                return
            }

            await interaction.editReply({
                content: `Event found! Event ID: \`${event.eventid}\``
            })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to resolve event id. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}