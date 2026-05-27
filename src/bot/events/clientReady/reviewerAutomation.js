'use strict'

const database = require('../../../api/database')

const LoggerClass = require('../../../api/logger.js')
const logger = new LoggerClass('ReviewerAutomation', 'BOT')

const {
    REVIEWER_AUTOMATION_CHANNEL_ID,
    REVIEWER_AUTOMATION_INTERVAL_MS,
    REVIEWER_LIST_EMPTY_MESSAGE,
    createWeeklyReviewerListEmbeds,
    summarizeReviewerReset,
    createReviewerResetEmbed,
    getScheduledReviewerAction
} = require('../../utils/reviewerAutomation.js')

function getStoredRunKey(value) {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && value.runKey) return String(value.runKey)
    return null
}

/**
 * @param {import('discord.js').Client} client
 */
async function fetchReviewerAutomationChannel(client) {
    let channel = client.channels.cache.get(REVIEWER_AUTOMATION_CHANNEL_ID)

    if (!channel) {
        try {
            channel = await client.channels.fetch(REVIEWER_AUTOMATION_CHANNEL_ID)
        } catch (err) {
            const msg = err && err.message ? err.message : String(err)
            logger.error('Failed to fetch reviewer automation channel ' + REVIEWER_AUTOMATION_CHANNEL_ID + ': ' + msg)
            return null
        }
    }

    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
        logger.error('Reviewer automation channel is not text-based: ' + REVIEWER_AUTOMATION_CHANNEL_ID)
        return null
    }

    return channel
}

/**
 * @param {import('discord.js').TextBasedChannel} channel
 */
async function postReviewerList(channel) {
    const rows = await database.getWeeklyMinorOfficerReviewCounts().catch(() => [])
    if (!Array.isArray(rows) || rows.length === 0) {
        await channel.send({ content: REVIEWER_LIST_EMPTY_MESSAGE })
        return
    }

    const embeds = createWeeklyReviewerListEmbeds(rows, channel.guild?.iconURL() ?? undefined)
    if (embeds.length === 0) {
        await channel.send({ content: REVIEWER_LIST_EMPTY_MESSAGE })
        return
    }

    await channel.send({ embeds: [embeds[0]] })

    for (let i = 1; i < embeds.length; i++) {
        await channel.send({ embeds: [embeds[i]] })
    }
}

/**
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {import('discord.js').Client} client
 */
async function runReviewerReset(channel, client) {
    const rows = await database.getWeeklyMinorOfficerReviewCounts().catch(() => [])
    const { reviewersCleared, reviewsCleared } = summarizeReviewerReset(rows)

    await database.resetWeeklyMinorOfficerReviewCounts()

    const executedBy = client.user
        ? `Executed by: Automated weekly schedule (<@${client.user.id}>)`
        : 'Executed by: Automated weekly schedule'

    const embed = createReviewerResetEmbed({
        rows,
        guildIconUrl: channel.guild?.iconURL() ?? undefined,
        footerText: 'WEEKLY REVIEWER RESET AUTOMATION',
        executedBy
    })

    try {
        await channel.send({ embeds: [embed] })
    } catch (err) {
        const msg = err && err.message ? err.message : String(err)
        logger.error('Weekly reviewer reset completed, but the confirmation message failed to send: ' + msg)
    } finally {
        logger.info(
            'Weekly reviewer reset completed by automation; ' +
            `channelId=${channel.id} reviewersCleared=${reviewersCleared} reviewsCleared=${reviewsCleared}`
        )
    }
}

/**
 * @param {import('discord.js').Client} client
 * @param {{ action: 'list' | 'reset', stateKey: string, runKey: string }} scheduledAction
 */
async function runScheduledReviewerAction(client, scheduledAction) {
    const channel = await fetchReviewerAutomationChannel(client)
    if (!channel) return false

    if (scheduledAction.action === 'list') {
        await postReviewerList(channel)
        logger.info(`Weekly reviewer list posted by automation; channelId=${channel.id}`)
        return true
    }

    if (scheduledAction.action === 'reset') {
        await runReviewerReset(channel, client)
        return true
    }

    return false
}

/**
 * @param {import('discord.js').Client} client
 */
async function checkReviewerAutomation(client) {
    const scheduledAction = getScheduledReviewerAction(new Date())
    if (!scheduledAction) return

    let storedValue = null
    try {
        storedValue = await database.getBotStateValue(scheduledAction.stateKey)
    } catch (err) {
        const msg = err && err.message ? err.message : String(err)
        logger.error('Failed to read reviewer automation bot state: ' + msg)
        return
    }

    if (getStoredRunKey(storedValue) === scheduledAction.runKey) return

    const completed = await runScheduledReviewerAction(client, scheduledAction)
    if (!completed) return

    try {
        await database.setBotStateValue(scheduledAction.stateKey, {
            runKey: scheduledAction.runKey,
            action: scheduledAction.action,
            channelId: REVIEWER_AUTOMATION_CHANNEL_ID,
            executedAt: new Date().toISOString()
        })
    } catch (err) {
        const msg = err && err.message ? err.message : String(err)
        logger.error('Failed to persist reviewer automation bot state: ' + msg)
    }
}

/**
 * @param {import('discord.js').Client} client
 */
async function runReviewerAutomationTick(client) {
    if (client.__reviewerAutomationTickInFlight) return

    client.__reviewerAutomationTickInFlight = true
    try {
        await checkReviewerAutomation(client)
    } finally {
        client.__reviewerAutomationTickInFlight = false
    }
}

/**
 * @param {import('discord.js').Client} client
 */
module.exports = async function handleReviewerAutomationReady(client) {
    if (client.__reviewerAutomationInterval) clearInterval(client.__reviewerAutomationInterval)

    await runReviewerAutomationTick(client)

    client.__reviewerAutomationInterval = setInterval(() => {
        runReviewerAutomationTick(client).catch((err) => {
            const msg = err && err.message ? err.message : String(err)
            logger.error('Reviewer automation tick failed: ' + msg)
        })
    }, REVIEWER_AUTOMATION_INTERVAL_MS)
}
