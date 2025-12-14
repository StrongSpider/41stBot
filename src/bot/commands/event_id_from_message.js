'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')

/**
 * Normalize a message URL into the canonical jump URL used by Discord
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
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            const raw = interaction.options.getString('message-url', true)
            const messageUrl = normalizeMessageUrl(raw)

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
                content: `Event found! Event ID: \`${event.eventId}\``
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