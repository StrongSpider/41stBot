'use strict'

const { BOT_GUILD_ID, INACTIVITY_NOTICE_ROLE_ID, EXEMPT_DISCORD_ROLE_ID } = require('../../../../config.json')
const { Client } = require('discord.js')
const { getInactivity, deleteInactivity } = require('../../../api/database.js')

/**
 * ready handler: schedule and run daily inactivity cleanups
 *
 * Scans the guild for members with an active inactivity notice. When the
 * notice end date has passed, it removes the inactivity role and, if the
 * new week window is active, grants the weekly exempt role. Sends a DM to
 * the user with the result.
 *
 * Behavior
 *  - Runs once on startup, then at local midnight every day
 *  - Fetches members up front to avoid stale role caches
 *  - Skips bots and members without an inactivity record
 *  - Uses best effort role updates and DMs, never throws
 *
 * Notes
 *  - Plain ASCII only
 *  - No semicolons
 *
 * @param {Client} client
 */
module.exports = async function handleInactivityNotices(client) {
    const guild = client.guilds.cache.get(BOT_GUILD_ID)
    if (!guild) return

    /**
     * Whether ending an inactivity notice should grant weekly exemption
     * Current rule: Sunday or Thursday to Saturday inclusive
     * @param {Date} d
     */
    function shouldGrantExempt(d) {
        const day = d.getDay() // 0=Sun, 1=Mon, ... 6=Sat
        return day === 0 || day >= 4
    }

    /**
     * Process a single member: clear expired notice, adjust roles, DM status
     * @param {import('discord.js').GuildMember} member
     */
    async function processMember(member) {
        if (!member || member.user.bot) return

        // DB lookup for this member's inactivity record
        let inactivity
        try { inactivity = await getInactivity(member.id) } catch { inactivity = null }
        if (!inactivity) return

        const endDate = new Date(inactivity.date)
        if (Number.isNaN(endDate.getTime())) return

        const now = Date.now()
        if (now <= endDate.getTime()) return

        // Past the end date: clear record and adjust roles
        try { await deleteInactivity(member.id) } catch { }
        console.log('Deleted inactivity notice for', member.user.tag)

        let failedRemove = false
        let failedExempt = false

        // Remove the inactivity role if present
        try {
            if (member.roles.cache.has(INACTIVITY_NOTICE_ROLE_ID)) {
                await member.roles.remove(INACTIVITY_NOTICE_ROLE_ID, 'Inactivity Notice Ended')
            }
        } catch (err) {
            console.error('Failed to remove inactivity notice role:', err && err.message ? err.message : err)
            failedRemove = true
        }

        // Optionally grant the exempt role based on the current weekday
        const grantExempt = shouldGrantExempt(new Date())
        if (grantExempt) {
            try {
                if (!member.roles.cache.has(EXEMPT_DISCORD_ROLE_ID)) {
                    await member.roles.add(EXEMPT_DISCORD_ROLE_ID, 'Inactivity Notice Ended')
                }
            } catch (err) {
                console.error('Failed to add exempt role:', err && err.message ? err.message : err)
                failedExempt = true
            }
        }

        if (failedRemove || failedExempt) {
            const extra = failedExempt ? ' and or add the exempt role' : ''
            console.log('Manual action needed for', member.id, 'failed to remove the inactivity notice role' + extra)
        }

        // Best effort DM to the user
        try {
            const status = grantExempt ? '**exempt** from quotas this week' : '**not exempt** and expected to complete your quota this week'
            await member.send('Your Inactivity Notice has ended. You are now ' + status + '.')
        } catch { }
    }

    /**
     * Run through all members once and process expirations
     */
    async function checkInactivity() {
        // Warm the member cache so role checks are correct
        try { await guild.members.fetch() } catch { }

        for (const member of guild.members.cache.values()) {
            try { await processMember(member) } catch { }
        }
    }

    // Initial run
    await checkInactivity()

    // Schedule the next run at local midnight, then every 24 hours
    const now = new Date()
    const nextMidnight = new Date(now)
    nextMidnight.setHours(24, 0, 0, 0)
    const delay = Math.max(0, nextMidnight.getTime() - now.getTime())

    setTimeout(() => {
        checkInactivity()
        setInterval(checkInactivity, 24 * 60 * 60 * 1000)
    }, delay)
}