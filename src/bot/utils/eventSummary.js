'use strict'

const config = require('../../../config.json')

const { OFFICER: DISCORD_OFFICER_ROLE_ID } = config.DISCORD.ROLES
const DISCORD_MENTION_REGEX = /<@!?(\d{17,20})>/g

/**
 * @param {Array<string|number|null|undefined>} ids
 * @returns {string[]}
 */
function uniqueDiscordIds(ids) {
    return Array.from(
        new Set(
            (ids || [])
                .filter(Boolean)
                .map(id => String(id))
        )
    )
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function parseMentionIds(text) {
    if (!text || typeof text !== 'string') return []
    return uniqueDiscordIds(Array.from(text.matchAll(DISCORD_MENTION_REGEX), match => match[1]))
}

/**
 * @param {string[]} lines
 * @param {string} key
 * @returns {string}
 */
function findSummaryLine(lines, key) {
    const prefix = `${String(key).toLowerCase()}:`
    return lines.find(line => line && line.toLowerCase().startsWith(prefix)) || ''
}

/**
 * @param {string} line
 * @returns {string}
 */
function stripSummaryLabel(line) {
    if (!line || typeof line !== 'string') return ''
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) return ''
    return line.slice(colonIndex + 1).trimStart()
}

/**
 * @param {string} line
 * @returns {number}
 */
function parseSummaryModifier(line) {
    if (!line || typeof line !== 'string') return 1
    const match = line.match(/modifier:\s*([0-9]+(?:\.[0-9]+)?)x?\s*ep/i)
    if (!match) return 1

    const value = Number.parseFloat(match[1])
    return Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * @param {{ eventName:string, note:string, baseEpPoints:number, attendees:Array<{discordId:string}>, extraRecipients:Array<{discordId:string}>, supervisor:{discordId:string}|null, host:{discordId:string} }} data
 * @param {import('discord.js').Guild} guild
 * @returns {string}
 */
function buildEventSummary({ eventName, note, baseEpPoints, attendees, extraRecipients, supervisor, host }, guild) {
    const lines = []
    lines.push(`Event: ${eventName}`)
    lines.push(`Host: <@${host.discordId}>`)
    if (supervisor) lines.push(`Supervisor: <@${supervisor.discordId}>`)

    const filteredAttendees = attendees.filter(user => user.discordId !== host.discordId)

    const officerAttendees = filteredAttendees.filter(user => {
        const member = guild?.members?.cache?.get?.(user.discordId)
        return Boolean(member?.roles?.cache?.has?.(DISCORD_OFFICER_ROLE_ID))
    })
    const regularAttendees = filteredAttendees.filter(user => {
        const member = guild?.members?.cache?.get?.(user.discordId)
        return !member?.roles?.cache?.has?.(DISCORD_OFFICER_ROLE_ID)
    })

    if (officerAttendees.length) {
        lines.push(`Officers: ${officerAttendees.map(user => `<@${user.discordId}>`).join(' ')}`)
    }
    if (regularAttendees.length) {
        lines.push(`Attendees: ${regularAttendees.map(user => `<@${user.discordId}>`).join(' ')}`)
    }
    if (extraRecipients.length) {
        lines.push(`Extra EP: ${extraRecipients.map(user => `<@${user.discordId}>`).join(' ')}`)
    }
    if (baseEpPoints > 1) lines.push(`Modifier: ${baseEpPoints}x EP`)
    if (note) lines.push(`Note: ${note}`)

    return lines.join('\n')
}

/**
 * @param {string} content
 * @returns {{
 *   eventName: string,
 *   hostDiscordId: string|null,
 *   supervisorDiscordId: string|null,
 *   officerDiscordIds: string[],
 *   attendeeDiscordIds: string[],
 *   baseDiscordIds: string[],
 *   extraDiscordIds: string[],
 *   note: string,
 *   baseEpPoints: number
 * }}
 */
function parseEventSummaryContent(content) {
    const lines = String(content || '').split('\n')

    const hostDiscordId = parseMentionIds(findSummaryLine(lines, 'host'))[0] || null
    const supervisorDiscordId = parseMentionIds(findSummaryLine(lines, 'supervisor'))[0] || null
    const officerDiscordIds = parseMentionIds(findSummaryLine(lines, 'officers'))
    const attendeeDiscordIds = parseMentionIds(findSummaryLine(lines, 'attendees'))
    const extraDiscordIds = parseMentionIds(findSummaryLine(lines, 'extra ep'))

    return {
        eventName: stripSummaryLabel(findSummaryLine(lines, 'event')),
        hostDiscordId,
        supervisorDiscordId,
        officerDiscordIds,
        attendeeDiscordIds,
        baseDiscordIds: uniqueDiscordIds([
            ...officerDiscordIds,
            ...attendeeDiscordIds,
            hostDiscordId,
            supervisorDiscordId
        ]),
        extraDiscordIds,
        note: stripSummaryLabel(findSummaryLine(lines, 'note')),
        baseEpPoints: parseSummaryModifier(findSummaryLine(lines, 'modifier'))
    }
}

module.exports = {
    buildEventSummary,
    parseEventSummaryContent,
    parseMentionIds,
    parseSummaryModifier,
    uniqueDiscordIds
}
