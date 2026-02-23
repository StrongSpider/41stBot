'use strict'

const config = require('../../../../config.json')
const { GUILD_ID: BOT_GUILD_ID } = config.DISCORD.BOT
const { INACTIVITY_NOTICE: INACTIVITY_NOTICE_ROLE_ID, EXEMPT: EXEMPT_DISCORD_ROLE_ID } = config.DISCORD.ROLES
const { Client } = require('discord.js')
const { getAllInactivities, deleteInactivity } = require('../../../api/database.js')

const LoggerClass = require('../../../api/logger.js')
const logger = new LoggerClass('InactivityNotices', 'BOT')

/**
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
     * @param {import('../../../api/types').InactivityNotice} notice
     */
    async function processMember(member, notice) {
        if (!member || member.user.bot) return

        const endDate = new Date(notice.date)
        if (Number.isNaN(endDate.getTime())) return

        const now = Date.now()
        if (now <= endDate.getTime()) return

        // Past the end date: clear record and adjust roles
        try { await deleteInactivity(member.id) } catch { }
        logger.info('Deleted inactivity notice for ' + member.user.tag)

        let failedRemove = false
        let failedExempt = false

        // Remove the inactivity role if present
        try {
            if (member.roles.cache.has(INACTIVITY_NOTICE_ROLE_ID)) {
                await member.roles.remove(INACTIVITY_NOTICE_ROLE_ID, 'Inactivity Notice Ended')
            }
        } catch (err) {
            logger.error('Failed to remove inactivity notice role: ' + (err && err.message ? err.message : err))
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
                logger.error('Failed to add exempt role: ' + (err && err.message ? err.message : err))
                failedExempt = true
            }
        }

        if (failedRemove || failedExempt) {
            const extra = failedExempt ? ' and or add the exempt role' : ''
            logger.warn('Manual action needed for ' + member.id + ' failed to remove the inactivity notice role' + extra)
        }

        // Best effort DM to the user
        try {
            const status = grantExempt ? '**exempt** from quotas this week' : '**not exempt** and expected to complete your quota this week'
            await member.send('Your Inactivity Notice has ended. You are now ' + status + '.')
        } catch { }
    }

    /**
     * Run through all database inactivities and process expirations
     */
    async function checkInactivity() {
        let inactivities
        try {
            inactivities = await getAllInactivities()
        } catch (err) {
            logger.error('Failed to fetch inactivities from database: ' + err.message)
            return
        }

        if (!inactivities || !inactivities.length) return

        // Warm the member cache so role checks are correct
        try { await guild.members.fetch() } catch { }

        for (const notice of inactivities) {
            try {
                const member = guild.members.cache.get(notice.discordId)

                const endDate = new Date(notice.date)
                if (Number.isNaN(endDate.getTime())) continue

                const now = Date.now()
                const isExpired = now > endDate.getTime()

                if (!member) {
                    // User not in server, check if expired to clean up DB
                    if (isExpired) {
                        try {
                            await deleteInactivity(notice.discordId)
                            logger.info(`Deleted inactivity notice for user ${notice.discordId} (left server and expired)`)
                        } catch (err) {
                            logger.error(`Failed to delete expired notice for user ${notice.discordId} who left: ${err.message}`)
                        }
                    }
                    continue
                }

                if (isExpired) {
                    await processMember(member, notice)
                }
            } catch (err) {
                logger.error(`Error processing inactivity notice for ${notice.discordId}: ${err && err.message ? err.message : err}`)
            }
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