'use strict'

const { PermissionsBitField } = require('discord.js')

/**
 * Check whether a guild interaction or guild member has Administrator.
 * @param {import('discord.js').CommandInteraction | import('discord.js').ContextMenuCommandInteraction | import('discord.js').GuildMember | import('discord.js').APIInteractionGuildMember | null | undefined} target
 * @returns {boolean}
 */
function isGuildAdministrator(target) {
    if (target?.memberPermissions?.has?.(PermissionsBitField.Flags.Administrator)) {
        return true
    }

    const member = target?.member ?? target
    return Boolean(member?.permissions?.has?.(PermissionsBitField.Flags.Administrator))
}

/**
 * Allow the configured developer and guild administrators to bypass
 * command-specific role gates.
 * @param {import('discord.js').CommandInteraction | import('discord.js').ContextMenuCommandInteraction} interaction
 * @param {string} developerDiscordUserId
 * @returns {boolean}
 */
function hasDeveloperOrAdminOverride(interaction, developerDiscordUserId) {
    return interaction?.user?.id === developerDiscordUserId || isGuildAdministrator(interaction)
}

module.exports = {
    isGuildAdministrator,
    hasDeveloperOrAdminOverride
}
