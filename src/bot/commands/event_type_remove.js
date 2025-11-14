'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')

/**
 * Check if the provided name is a valid event type
 * @param {unknown} v
 * @returns {boolean}
 */
function isValidEventName(v) {
    if (typeof v !== 'string') return false
    const s = v.trim()
    if (s.length === 0 || s.length > 64) return false
    if (!/[\x20-\x7E]+/.test(s)) return false // printable ASCII only
    if (!/^[A-Za-z0-9._\- ]+$/.test(s)) return false
    return true
}

/**
 * Normalize an event name by trimming and collapsing internal whitespace
 * @param {string} s
 */
function normalizeName(s) {
    return s.trim().replace(/\s+/g, ' ')
}

module.exports = {
    permission: 'HICOM',
    data: new SlashCommandBuilder()
        .setName('event-type-remove')
        .setDescription('Remove an event type from autocomplete')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Event type string to remove')
                .setRequired(true)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const raw = interaction.options.getString('type', true)
            const name = normalizeName(raw)

            // Validate before attempting removal so we can give a clear message
            if (!isValidEventName(name)) {
                await interaction.reply({ content: 'Invalid event type. Use 1-64 printable characters: letters, numbers, space, . _ -', flags: MessageFlags.Ephemeral })
                return
            }

            await database.removeEventType(name)

            return interaction.reply({ content: `Event \`${name}\` removed` })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to remove event type. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}