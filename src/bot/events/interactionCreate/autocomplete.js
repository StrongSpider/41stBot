'use strict'

/**
 * interactionCreate autocomplete handler
 *
 * Delegates Discord autocomplete interactions to the matching command's
 * optional `autocomplete(interaction)` method.
 *
 * Behavior
 *  - Ignores non-autocomplete interactions
 *  - Ignores DMs by requiring a guild context
 *  - Skips commands that do not implement an autocomplete handler
 *  - Logs concise errors without throwing
 *
 * Notes
 *  - Plain ASCII, no semicolons
 *
 * @param {import('discord.js').BaseInteraction} interaction
 */
module.exports = async function autocompleteHandler(interaction) {
    try {
        if (!interaction || typeof interaction.isAutocomplete !== 'function') return
        if (!interaction.isAutocomplete()) return

        // Only handle in guilds to avoid DM edge cases
        if (typeof interaction.inGuild === 'function') {
            if (!interaction.inGuild()) return
        } else if (!interaction.guild) {
            return
        }

        const name = interaction.commandName
        const commands = interaction.client && interaction.client.commands
        const command = commands && typeof commands.get === 'function' ? commands.get(name) : null
        if (!command) {
            console.error('autocomplete: no command found for ' + String(name))
            return
        }

        if (typeof command.autocomplete !== 'function') return

        await command.autocomplete(interaction)
    } catch (err) {
        const msg = err && err.message ? err.message : String(err)
        const name = interaction && interaction.commandName ? interaction.commandName : 'unknown'
        console.error('autocomplete error for ' + String(name) + ': ' + msg)
    }
}