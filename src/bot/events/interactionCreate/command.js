'use strict'

const config = require('../../../../config.json')
const { FFCNC: DISCORD_FFCNC_ROLE_ID, HICOM: DISCORD_HICOM_ROLE_ID, OFFICER: DISCORD_OFFICER_ROLE_ID, MINOR_OFFICER: DISCORD_MINOR_OFFICER_ROLE_ID, CMOTW: DISCORD_CMOTW_ROLE_ID } = config.DISCORD.ROLES
const { DEVELOPER_USER_ID: DEVELOPER_DISCORD_USER_ID } = config.DISCORD.BOT
const database = require('../../../api/database')
const { formatEventEpLockMessage } = require('../../utils/eventEpLock.js')


const LoggerClass = require('../../../api/logger.js')
const logger = new LoggerClass('Command', 'BOT')

const { MessageFlags } = require('discord.js')
const { hasDeveloperOrAdminOverride } = require('../../utils/interactionPermissions.js')
const { resolveCommand } = require('../../commandRegistry.js')

function getInteractionCommandLogName(interaction) {
    const commandName = interaction?.commandName
    if (!commandName) return 'unknown'

    const options = interaction?.options
    let groupName = null
    let subcommandName = null

    try {
        if (typeof options?.getSubcommandGroup === 'function') {
            groupName = options.getSubcommandGroup(false)
        }
    } catch { }

    try {
        if (typeof options?.getSubcommand === 'function') {
            subcommandName = options.getSubcommand(false)
        }
    } catch { }

    return `\`${[commandName, groupName, subcommandName].filter(Boolean).join(' ')}\``
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ContextMenuCommandInteraction} interaction
 */
module.exports = async function commandHandler(interaction) {
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
            logger.info('Received command:', getInteractionCommandLogName(interaction), 'from', uname, '(', uid, ')')
            //await sendCommandReceived(interaction.commandName, uname, uid)
        } catch { }

        const cmds = interaction.client?.commands
        const command = resolveCommand(cmds, interaction)
        if (!command) {
            logger.error('No command matching', String(interaction.commandName), 'was found')
            return
        }

        // Default to ALL if not specified
        command.permission = command.permission || 'ALL'

        // Permission check with developer/admin override
        const hasOverride = hasDeveloperOrAdminOverride(interaction, DEVELOPER_DISCORD_USER_ID)
        if (!hasOverride && command.permission !== 'ALL') {
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

        if (command.requiresEventEpWrite) {
            const lockState = await database.getEventEpLock()
            if (lockState && lockState.enabled) {
                await interaction.reply({ content: formatEventEpLockMessage(lockState), flags: MessageFlags.Ephemeral })
                return
            }
        }

        // Execute the command
        await command.execute(interaction)
    } catch (error) {
        const users = interaction?.client?.users
        const uid = interaction?.user?.id
        const lockMsg = database.isEventEpLockError(error) ? formatEventEpLockMessage(error.lockState) : null
        const msg = lockMsg || (error && error.message ? String(error.message) : 'Unknown error')

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
