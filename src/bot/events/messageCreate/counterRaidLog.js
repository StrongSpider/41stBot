'use strict'

const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js')
const { sendEventCreateWebhook } = require('../../../api/webhook.js')
const database = require('../../../api/database.js')
const { DISCORD_CHANNEL_IDS, DISCORD_ERT_OFFICER_ROLE_IDS, DISCORD_HICOM_ROLE_ID, DEVELOPER_DISCORD_USER_ID } = require('../../../../config.json')

/**
 * Build the approval buttons used by approvers
 */
function createMinorActionButtons() {
    const confirm = new ButtonBuilder()
        .setCustomId('confirm_minor')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Secondary)
    const deny = new ButtonBuilder()
        .setCustomId('deny_minor')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary)
    return new ActionRowBuilder().addComponents(confirm, deny)
}

/** Extract all user ids from a mention list on a single line */
function parseMentions(line) {
    if (!line || typeof line !== 'string') return []
    const matches = line.match(/<@!?([0-9]{17,20})>/g) || []
    return matches.map(m => m.replace(/[<@!>]/g, ''))
}

/** Case-insensitive startsWith helper */
function findLine(lines, key) {
    const k = String(key).toLowerCase()
    return lines.find(l => l && l.toLowerCase().startsWith(k)) || ''
}

/** Check if an attachment looks like an image */
function isImageAttachment(att) {
    try {
        if (!att) return false
        if (att.contentType && typeof att.contentType === 'string') {
            return att.contentType.toLowerCase().startsWith('image/')
        }
        const url = String(att.url || '')
        return /\.(png|jpe?g|gif|webp|bmp)$/i.test(url)
    } catch { return false }
}

/**
 * @param {import('discord.js').Message} message
 */
module.exports = async function counterRaidLog(message) {
    try {
        if (!message || message.author?.bot) return
        if (message.channelId !== DISCORD_CHANNEL_IDS?.COUNTER_RAID_LOGS) return

        // Skip if author is ERT officer, HICOM, or developer
        let ertOfficer = false
        if (Array.isArray(DISCORD_ERT_OFFICER_ROLE_IDS)) {
            for (const roleId of DISCORD_ERT_OFFICER_ROLE_IDS) {
                if (message.member?.roles?.cache?.has(roleId)) { ertOfficer = true; break }
            }
        }
        if (ertOfficer || message.member?.roles?.cache?.has(DISCORD_HICOM_ROLE_ID) || message.member?.id === DEVELOPER_DISCORD_USER_ID) {
            return
        }

        const lines = String(message.content || '').split('\n')
        const attendeesLine = findLine(lines, 'attendees:')
        const hostLine = findLine(lines, 'host:')

        if (!attendeesLine || !hostLine) {
            try {
                await message.member.send('Your message in <#' + DISCORD_CHANNEL_IDS.COUNTER_RAID_LOGS + '> does not follow the post format. Here was your message:\n```' + message.content + '```')
            } catch { }
            try { await message.delete() } catch { }
            return
        }

        // Require at least one image attachment
        const firstAtt = message.attachments?.first?.() || (message.attachments && message.attachments.first())
        if (!firstAtt || !isImageAttachment(firstAtt)) {
            try {
                await message.member.send('Your message in <#' + DISCORD_CHANNEL_IDS.COUNTER_RAID_LOGS + '> must include an image attachment. Here was your message:\n```' + message.content + '```')
            } catch { }
            try { await message.delete() } catch { }
            return
        }

        // Build attendee list from mentions, include host
        let attendeeIds = parseMentions(attendeesLine)
        const hostId = parseMentions(hostLine)[0] || null
        if (hostId && !attendeeIds.includes(hostId)) attendeeIds.push(hostId)

        // Map Discord ids to Roblox ids
        const invalidDiscordIds = []
        const attendeeRobloxIds = []
        for (const discordId of attendeeIds) {
            try {
                const robloxId = await database.getRobloxIdByDiscord(discordId)
                if (robloxId) attendeeRobloxIds.push(robloxId)
                else invalidDiscordIds.push(discordId)
            } catch { invalidDiscordIds.push(discordId) }
        }

        let hostRobloxId = null
        if (hostId) {
            try { hostRobloxId = await database.getRobloxIdByDiscord(hostId) } catch { }
            if (!hostRobloxId) invalidDiscordIds.push(hostId)
        }

        if (!hostRobloxId) {
            try {
                await message.member.send('The host you specified does not have a linked Roblox account. Make sure they are verified. Here was your message:\n```' + message.content + '```')
                if (invalidDiscordIds.length) {
                    await message.member.send('These users are not linked: ' + invalidDiscordIds.map(id => '<@' + id + '>').join(', '))
                }
            } catch { }
            try { await message.delete() } catch { }
            return
        }

        // Repost the log with buttons for approvers
        let botMessage
        try {
            botMessage = await message.channel.send({ content: message.content, files: [firstAtt.url], components: [createMinorActionButtons()] })
        } catch { }
        try { await message.delete() } catch { }

        // Store the event
        try {
            const createdId = await database.createWeeklyEvent({
                type: 'Counter Raid',
                host: hostRobloxId,
                attendees: attendeeRobloxIds,
                message: botMessage?.url,
                timestamp: new Date().toISOString(),
                supervisor: -1
            })

            await sendEventCreateWebhook({
                eventId: createdId,
                type: 'Counter Raid',
                host: hostRobloxId,
                supervisor: -1,
                attendees: attendeeRobloxIds,
                message: botMessage?.url,
                timestamp: new Date().toISOString()
            })
        } catch (e) {
            console.error('Failed to create weekly event:', e && e.message ? e.message : e)
        }
    } catch (e) {
        console.error('Error in messageCreate counterRaidLog:', e && e.message ? e.message : e)
    }
}