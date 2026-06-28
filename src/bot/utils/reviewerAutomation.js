'use strict'

const { EmbedBuilder } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL

const REVIEWER_AUTOMATION_UTC_OFFSET_HOURS = -4
const REVIEWER_AUTOMATION_CHANNEL_ID = config.DISCORD?.CHANNELS?.REVIEWER_WEEKLY_REPORTS
const REVIEWER_AUTOMATION_INTERVAL_MS = 30 * 1000
const REVIEWER_LIST_STATE_KEY = 'reviewer_weekly_list_last_run'
const REVIEWER_RESET_STATE_KEY = 'reviewer_weekly_reset_last_run'
const REVIEWER_LIST_EMPTY_MESSAGE = '<:warning:1297618648810393630> `No weekly reviewer data available right now`'

/**
 * @param {Array<{discordId: string, count: number}>} rows
 * @returns {Array<{discordId: string, count: number}>}
 */
function normalizeReviewerRows(rows) {
    if (!Array.isArray(rows)) return []

    return rows
        .map((row) => ({
            discordId: String(row?.discordId || ''),
            count: Number(row?.count) || 0
        }))
        .filter((row) => row.discordId.length > 0)
}

/**
 * @param {Array<{discordId: string, count: number}>} rows
 */
function sortReviewerRows(rows) {
    rows.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count
        return String(a.discordId).localeCompare(String(b.discordId))
    })
}

/**
 * Keep each chunk under Discord embed description limits.
 * @param {string[]} lines
 * @returns {string[][]}
 */
function chunkLines(lines) {
    const chunks = []
    let current = []
    let currentLength = 0
    const maxChars = 3800

    for (const line of lines) {
        const nextLength = currentLength + (current.length ? 1 : 0) + line.length
        if (nextLength > maxChars && current.length) {
            chunks.push(current)
            current = [line]
            currentLength = line.length
            continue
        }

        current.push(line)
        currentLength = nextLength
    }

    if (current.length) chunks.push(current)
    return chunks
}

/**
 * @param {Array<{discordId: string, count: number}>} rows
 * @param {string | undefined} guildIconUrl
 * @returns {EmbedBuilder[]}
 */
function createWeeklyReviewerListEmbeds(rows, guildIconUrl) {
    const normalized = normalizeReviewerRows(rows)
    if (normalized.length === 0) return []

    sortReviewerRows(normalized)

    const lines = normalized.map((row, index) =>
        `${index + 1}. <@${row.discordId}> ${row.count}`
    )

    const chunks = chunkLines(lines)
    return chunks.map((chunk, index) =>
        new EmbedBuilder()
            .setFooter({ text: '41ST BOT', iconURL: guildIconUrl ?? undefined })
            .setTitle(`Weekly Minor Reviewers (${index + 1}/${chunks.length})`)
            .setColor(EMBED_COLOR)
            .setTimestamp()
            .setDescription(chunk.join('\n'))
    )
}

/**
 * @param {Array<{discordId: string, count: number}>} rows
 * @returns {{reviewersCleared: number, reviewsCleared: number}}
 */
function summarizeReviewerReset(rows) {
    const normalized = normalizeReviewerRows(rows)
    return {
        reviewersCleared: normalized.length,
        reviewsCleared: normalized.reduce((sum, row) => sum + row.count, 0)
    }
}

/**
 * @param {object} options
 * @param {Array<{discordId: string, count: number}>} options.rows
 * @param {string | undefined} options.guildIconUrl
 * @param {string} options.footerText
 * @param {string} options.executedBy
 * @returns {EmbedBuilder}
 */
function createReviewerResetEmbed({ rows, guildIconUrl, footerText, executedBy }) {
    const { reviewersCleared, reviewsCleared } = summarizeReviewerReset(rows)

    return new EmbedBuilder()
        .setFooter({ text: footerText, iconURL: guildIconUrl ?? undefined })
        .setTitle('Reset Weekly Reviewer Data')
        .setColor(EMBED_COLOR)
        .setTimestamp()
        .setDescription(executedBy)
        .addFields([
            { name: 'Reviewers cleared', value: String(reviewersCleared), inline: true },
            { name: 'Review count removed', value: String(reviewsCleared), inline: true }
        ])
}

/**
 * @param {Date} [date]
 * @returns {{ weekday: string, year: string, month: string, day: string, hour: number, minute: number }}
 */
function getReviewerScheduleParts(date = new Date()) {
    const shiftedDate = new Date(date.getTime() + (REVIEWER_AUTOMATION_UTC_OFFSET_HOURS * 60 * 60 * 1000))
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    return {
        weekday: weekdays[shiftedDate.getUTCDay()],
        year: String(shiftedDate.getUTCFullYear()),
        month: String(shiftedDate.getUTCMonth() + 1).padStart(2, '0'),
        day: String(shiftedDate.getUTCDate()).padStart(2, '0'),
        hour: shiftedDate.getUTCHours(),
        minute: shiftedDate.getUTCMinutes()
    }
}

/**
 * Uses a fixed UTC-4 offset year-round.
 * @param {Date} [date]
 * @returns {{ action: 'list' | 'reset', stateKey: string, runKey: string } | null}
 */
function getScheduledReviewerAction(date = new Date()) {
    const parts = getReviewerScheduleParts(date)
    if (parts.weekday !== 'Sun') return null

    const runKey = `${parts.year}-${parts.month}-${parts.day}`

    if (parts.hour === 22 && parts.minute === 0) {
        return {
            action: 'list',
            stateKey: REVIEWER_LIST_STATE_KEY,
            runKey
        }
    }

    if (parts.hour === 22 && parts.minute === 1) {
        return {
            action: 'reset',
            stateKey: REVIEWER_RESET_STATE_KEY,
            runKey
        }
    }

    return null
}

module.exports = {
    REVIEWER_AUTOMATION_UTC_OFFSET_HOURS,
    REVIEWER_AUTOMATION_CHANNEL_ID,
    REVIEWER_AUTOMATION_INTERVAL_MS,
    REVIEWER_LIST_STATE_KEY,
    REVIEWER_RESET_STATE_KEY,
    REVIEWER_LIST_EMPTY_MESSAGE,
    createWeeklyReviewerListEmbeds,
    summarizeReviewerReset,
    createReviewerResetEmbed,
    getScheduledReviewerAction
}
