'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')

/**
 * /event-type-remove command
 *
 * Remove an event type string from the autocomplete list.
 *
 * Behavior
 *  - Normalizes whitespace and validates the name
 *  - Public success reply, private error fallbacks using MessageFlags.Ephemeral
 *
 * Validation rules
 *  - Printable ASCII only
 *  - Allowed chars: letters, numbers, space, dot, underscore, hyphen
 *  - Length 1 to 64 after trimming
 *
 * @file event_type_remove.js
 */

/**
 * Check if the provided name is a valid event type
 * Keep rules in sync with event_type_add.js
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
     * Handle the command
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

            // Remove from DB. Implementation may be idempotent. We do not leak existence details.
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