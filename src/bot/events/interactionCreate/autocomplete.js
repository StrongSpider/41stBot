'use strict'
const Logger = require('../../../api/logger.js')

/**
 * @param {import('discord.js').AutocompleteInteraction} interaction
 */
module.exports = async function autocompleteHandler(interaction) {
    const logger = new Logger('Autocomplete', 'BOT')
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
            logger.error('no command found for ' + String(name))
            return
        }

        if (typeof command.autocomplete !== 'function') return

        await command.autocomplete(interaction)
    } catch (err) {
        const msg = err && err.message ? err.message : String(err)
        const name = interaction && interaction.commandName ? interaction.commandName : 'unknown'
        logger.error('error for ' + String(name) + ': ' + msg)
    }
}