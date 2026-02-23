'use strict'

const config = require('../../../../config.json')

const LoggerClass = require('../../../api/logger.js')
const logger = new LoggerClass('AutoRole', 'BOT')

/**
 * @param {import('discord.js').GuildMember} member
 */
module.exports = async function autoRole(member) {
    try {
        if (!member || !member.user) return
        if (member.user.bot) return

        const autoRoleIds = config.DISCORD.ROLES.AUTO_ROLES
        if (!autoRoleIds || autoRoleIds.length === 0) return

        const rolesToAdd = autoRoleIds.map(roleId => member.guild.roles.cache.get(roleId)).filter(role => role)
        if (rolesToAdd.length === 0) return

        await member.roles.add(rolesToAdd, 'Auto Role')

        // Exemption role for Thursday to Sunday
        const exemptionRoleId = config.DISCORD.ROLES.EXEMPT
        if (!exemptionRoleId) return

        const exemptionRole = member.guild.roles.cache.get(exemptionRoleId)
        if (!exemptionRole) return

        const today = new Date()
        const dayOfWeek = today.getUTCDay() // 0 (Sunday) to 6 (Saturday)
        if (dayOfWeek >= 4 && dayOfWeek <= 0) { // Thursday to Sunday
            await member.roles.add(exemptionRole, 'Exemption role for Thursday to Sunday')
        }
    } catch (e) {
        logger.error('Error assigning auto roles to new member:', e)
    }
}