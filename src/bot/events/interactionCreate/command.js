'use strict'

const { DISCORD_FFCNC_ROLE_ID, DISCORD_HICOM_ROLE_ID, DISCORD_OFFICER_ROLE_ID, DISCORD_MINOR_OFFICER_ROLE_ID, DEVELOPER_DISCORD_USER_ID, DISCORD_CMOTW_ROLE_ID } = require('../../../../config.json')
const { sendCommandReceived } = require('../../../api/webhook.js')
const Logger = require('../../../api/logger.js')
const { MessageFlags } = require('discord.js')

/**
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ContextMenuCommandInteraction} interaction
 */
module.exports = async function commandHandler(interaction) {
    const logger = new Logger('Command', 'BOT')
    try {
        if (!interaction || !(interaction.isChatInputCommand?.() || interaction.isContextMenuCommand?.())) return

        // Block DMs. Some interactions have no channel object, so prefer inGuild()
        const inGuild = typeof interaction.inGuild === 'function' ? interaction.inGuild() : Boolean(interaction.guild)
        if (!inGuild) {
            if (interaction.isRepliable?.()) {
                await interaction.reply({ content: '<:warning:1297618648810393630> `This command cannot be used in DMs.`', flags: MessageFlags.Ephemeral })
            }
            return
        }

        try {
            const uname = interaction.user?.username || 'unknown'
            const uid = interaction.user?.id || 'unknown'
            logger.info('Received command:', interaction.commandName, 'from', uname, '(', uid, ')')
            //await sendCommandReceived(interaction.commandName, uname, uid)
        } catch { }

        const cmds = interaction.client?.commands
        const command = cmds && typeof cmds.get === 'function' ? cmds.get(interaction.commandName) : null
        if (!command) {
            logger.error('No command matching', String(interaction.commandName), 'was found')
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
            else if (command.permission === 'MINOR_OFFICER') allowed = hasRole(DISCORD_MINOR_OFFICER_ROLE_ID) || hasRole(DISCORD_CMOTW_ROLE_ID)

            if (!allowed) {
                await interaction.reply({ content: '<:warning:1297618648810393630> You do not have permission to use this command.', flags: MessageFlags.Ephemeral })
                return
            }
        }

        // Execute the command
        await command.execute(interaction)
    } catch (error) {
        const users = interaction?.client?.users
        const uid = interaction?.user?.id
        const msg = error && error.message ? String(error.message) : 'Unknown error'

        logger.error(error)
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