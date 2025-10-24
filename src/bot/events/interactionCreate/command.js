'use strict'

const { DISCORD_FFCNC_ROLE_ID, DISCORD_HICOM_ROLE_ID, DISCORD_OFFICER_ROLE_ID, DISCORD_MINOR_OFFICER_ROLE_ID, DEVELOPER_DISCORD_USER_ID } = require('../../../../config.json')
const { sendCommandReceived } = require('../../../api/webhook.js')
const { MessageFlags } = require('discord.js')

/**
 * interactionCreate command handler
 *
 * Routes chat input and context menu commands to their command module
 * and enforces simple role-based permissions.
 *
 * Behavior
 *  - Rejects DM usage with an ephemeral notice
 *  - Looks up the command by name from client.commands
 *  - Applies role-gated permissions with a developer override
 *  - Executes the command and reports errors privately
 *
 * Notes
 *  - Keep output plain ASCII
 *  - Use MessageFlags.Ephemeral instead of the ephemeral property
 *
 * @param {import('discord.js').BaseInteraction} interaction
 */
module.exports = async function commandHandler(interaction) {
    try {
        // Only handle application commands
        if (!interaction || !(interaction.isChatInputCommand?.() || interaction.isContextMenuCommand?.())) return

        // Block DMs early. Some interactions have no channel object, so prefer inGuild()
        const inGuild = typeof interaction.inGuild === 'function' ? interaction.inGuild() : Boolean(interaction.guild)
        if (!inGuild) {
            if (interaction.isRepliable?.()) {
                await interaction.reply({ content: '<:warning:1297618648810393630> `This command cannot be used in DMs.`', flags: MessageFlags.Ephemeral })
            }
            return
        }

        // Log and fire webhook (best effort)
        try {
            const uname = interaction.user?.username || 'unknown'
            const uid = interaction.user?.id || 'unknown'
            console.log('Received command:', interaction.commandName, 'from', uname, '(', uid, ')')
            await sendCommandReceived(interaction.commandName, uname, uid)
        } catch { }

        const cmds = interaction.client?.commands
        const command = cmds && typeof cmds.get === 'function' ? cmds.get(interaction.commandName) : null
        if (!command) {
            console.error('No command matching', String(interaction.commandName), 'was found')
            return
        }

        // Default to ALL if not specified
        command.permission = command.permission || 'ALL'

        // Permission check with developer override
        const isDev = interaction.user?.id === DEVELOPER_DISCORD_USER_ID
        if (!isDev && command.permission !== 'ALL') {
            const member = interaction.member
            const hasRole = (roleId) => Boolean(roleId && member && member.roles?.cache?.has(roleId))

            let allowed = false
            if (command.permission === 'FFCNC') allowed = hasRole(DISCORD_FFCNC_ROLE_ID)
            else if (command.permission === 'HICOM') allowed = hasRole(DISCORD_HICOM_ROLE_ID)
            else if (command.permission === 'OFFICER') allowed = hasRole(DISCORD_OFFICER_ROLE_ID)
            else if (command.permission === 'MINOR_OFFICER') allowed = hasRole(DISCORD_MINOR_OFFICER_ROLE_ID)

            if (!allowed) {
                await interaction.reply({ content: '<:warning:1297618648810393630> You do not have permission to use this command.', flags: MessageFlags.Ephemeral })
                return
            }
        }

        // Execute the command
        await command.execute(interaction)
    } catch (error) {
        // Private, robust error reporting
        const users = interaction?.client?.users
        const uid = interaction?.user?.id
        const msg = error && error.message ? String(error.message) : 'Unknown error'

        console.error(error)
        try {
            if (interaction?.replied || interaction?.deferred) {
                await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral })
            } else if (interaction?.isRepliable?.()) {
                await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral })
            }
        } catch {
            try {
                if (users && uid) {
                    const userObj = await users.fetch(uid).catch(() => null)
                    if (userObj) await userObj.send('Error from your command!')
                }
            } catch { }
        }
    }
}