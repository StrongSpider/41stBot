'use strict'

const database = require('../../../api/database.js')
const config = require('../../../../config.json')
const { DISCORD } = config
const { CHANNELS: DISCORD_CHANNEL_IDS, ROLES } = DISCORD
const UNIT_ROLES = ROLES.UNIT

/** Small delay helper used to rate-limit role changes */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * @param {import('discord.js').Message} message
 */
module.exports = async function garBotLog(message) {
    try {
        if (!message) return
        if (message.channelId !== DISCORD_CHANNEL_IDS.GAR_BOT_LOGS) return
        if (!message.webhookId) return

        // Raw content from the webhook. The GAR bot formats details inline.
        const str = String(message.cleanContent || '')
        if (!str) return

        // First boundary "(Username, 123456789)" – we only trust what comes after this
        const FIRST_PAIR_RE = /\(\s*[A-Za-z0-9_]{3,20}\s*,\s*(\d{3,})\s*\)/

        // Action flag: "has set" or "has kicked" – capture the verb
        const ACTION_RE = /\bhas\s+(set|kicked)\b/i

        // Target immediately after the action: "User123 (123456789)" – capture the id only
        const USER_AFTER_ACTION_ID_RE = /\b[A-Za-z0-9_]{3,20}\s*\(\s*(\d{3,})\s*\)/

        // Rank capture: "to the **Trooper (10)** rank" – capture inside the bold
        const RANK_RE = /\bto the\s+\*\*([^*]+?)\*\*\s+rank\b/i

        // 1) Find boundary after first "(Username, ID)"
        const firstPair = FIRST_PAIR_RE.exec(str)
        if (!firstPair || typeof firstPair.index !== 'number') return

        const afterFirst = str.slice(firstPair.index + firstPair[0].length)

        // 2) Find action only after that boundary
        const actionMatch = ACTION_RE.exec(afterFirst)
        if (!actionMatch) return
        const actionVerb = String(actionMatch[1]).toLowerCase() // 'set' or 'kicked'

        // 3) From just after the action, extract target user id and rank (if set)
        const afterAction = afterFirst.slice(actionMatch.index + actionMatch[0].length)

        const targetIdMatch = USER_AFTER_ACTION_ID_RE.exec(afterAction)
        const targetRobloxId = targetIdMatch ? targetIdMatch[1] : null

        // Rank name like "Trooper" or "Ranger Platoon" (strip trailing "(10)")
        let rankName = null
        const rankMatch = RANK_RE.exec(afterAction)
        if (rankMatch) rankName = rankMatch[1].replace(/\s*\(\d+\)\s*$/, '').trim()

        if (!targetRobloxId) return

        // Resolve the Discord member mapped to this Roblox id
        let discordId = null
        try { discordId = await database.getDiscordIdByRoblox(targetRobloxId) } catch { }
        if (!discordId) return

        let discordMember = null
        try { discordMember = await message.guild.members.fetch(discordId) } catch { }
        if (!discordMember) return

        if (actionVerb === 'kicked') {
            // Member was kicked from the Roblox group – remove from Discord guild
            try {
                await discordMember.kick(`Removed from group by ${message.mentions.users.first() ? message.mentions.users.first().username : 'an unknown user'}`)
                await message.react('✅').catch(() => { })
                console.log('GARBotLog: kicked guild member', discordId, 'for Roblox id', targetRobloxId)
            } catch (e) {
                await message.react('❌').catch(() => { })
                console.error('GARBotLog: failed to kick', discordId, '-', e && e.message ? e.message : e)
            }
            return
        }

        if (actionVerb === 'set') {
            // Rank change – ensure we have a matching unit entry
            if (!rankName) return
            const unit = Array.isArray(UNIT_ROLES) ? UNIT_ROLES.find(u => u && u.unit === rankName) : null
            if (!unit) return

            // Build the list of roles to remove: all company roles not matching the new unit
            const removeRoleIds = []
            if (Array.isArray(UNIT_ROLES)) {
                for (const u of UNIT_ROLES) {
                    if (!u || u.unit === rankName || !Array.isArray(u.roles)) continue
                    for (const rid of u.roles) removeRoleIds.push(rid)
                }
            }

            const currentToRemove = discordMember.roles.cache
                .filter(r => removeRoleIds.includes(r.id))
                .map(r => r.id)

            for (const rid of currentToRemove) {
                try { await discordMember.roles.remove(rid, 'GAR group change: removing other company roles') } catch { }
                await sleep(50)
            }

            console.log('GARBotLog: updated roles for', discordId, 'rank', rankName, 'removed', currentToRemove.length)
            return
        }
    } catch (e) {
        console.error('Error in GARBotLog handler:', e && e.message ? e.message : e)
    }
}