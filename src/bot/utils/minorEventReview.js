'use strict'

const config = require('../../../config.json')
const database = require('../../api/database.js')

const {
    OFFICER: DISCORD_OFFICER_ROLE_ID,
    FFCNC: DISCORD_FFCNC_ROLE_ID,
    ERT_OFFICER: DISCORD_ERT_OFFICER_ROLE_IDS
} = config.DISCORD.ROLES
const { DEVELOPER_USER_ID: DEVELOPER_DISCORD_USER_ID } = config.DISCORD.BOT

const MINOR_REVIEW_EVENT_NOT_FOUND_MESSAGE = '<:warning:1297618648810393630> `I could not find this event! Ask a HICOM+ to remove this.`'

/**
 * @param {import('discord.js').GuildMember|import('discord.js').APIInteractionGuildMember|undefined|null} member
 * @param {string} roleId
 * @returns {boolean}
 */
function memberHasRole(member, roleId) {
    return Boolean(roleId && member?.roles?.cache?.has?.(roleId))
}

/**
 * @param {import('discord.js').GuildMember|import('discord.js').APIInteractionGuildMember|undefined|null} member
 * @param {string[]|undefined|null} roleIds
 * @returns {boolean}
 */
function memberHasAnyRole(member, roleIds) {
    return Array.isArray(roleIds) && roleIds.some(roleId => memberHasRole(member, roleId))
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<import('../../api/db/types').Event|null>}
 */
async function findMinorReviewEvent(interaction) {
    return database.findEventByMessage(interaction.message?.url)
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {{ type?: string }|null} event
 * @returns {boolean}
 */
function canManageMinorReviewEvent(interaction, event) {
    if (!event) return false
    if (interaction.user?.id === DEVELOPER_DISCORD_USER_ID) return true

    if (event.type !== 'Counter Raid') {
        return memberHasRole(interaction.member, DISCORD_OFFICER_ROLE_ID)
    }

    return (
        memberHasRole(interaction.member, DISCORD_FFCNC_ROLE_ID) ||
        memberHasAnyRole(interaction.member, DISCORD_ERT_OFFICER_ROLE_IDS)
    )
}

/**
 * @param {'approve'|'deny'} action
 * @returns {string}
 */
function getMinorReviewPermissionError(action) {
    return `<:warning:1297618648810393630> \`You do not have sufficient permissions to ${action} this event!\``
}

module.exports = {
    MINOR_REVIEW_EVENT_NOT_FOUND_MESSAGE,
    findMinorReviewEvent,
    canManageMinorReviewEvent,
    getMinorReviewPermissionError
}
