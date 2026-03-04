'use strict'
const LoggerClass = require('../../../api/logger.js')
const logger = new LoggerClass('Autocomplete', 'BOT')
const { resolveCommand } = require('../../commandRegistry.js')

/**
 * @param {import('discord.js').AutocompleteInteraction} interaction
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

        const commands = interaction.client && interaction.client.commands
        const command = resolveCommand(commands, interaction)
        if (!command) {
            logger.error('no command found for ' + String(interaction.commandName))
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
