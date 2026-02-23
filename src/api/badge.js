'use strict'

const database = require('./database.js')
const proxy = require('./proxy.js')
const axios = require('axios')
const https = require('https')

const BADGES_DEBUG = false

const LoggerClass = require('./logger.js')
const logger = new LoggerClass('Badges', 'API')

function debugLog(...args) {
    if (!BADGES_DEBUG) return
    logger.debug(...args)
}

function debugWarn(...args) {
    if (!BADGES_DEBUG) return
    logger.warn(...args)
}

/**
 * Safely extract the retry-after header from an axios style error.
 *
 * @param {any} err
 * @returns {string|null}
 */
function getRetryAfter(err) {
    if (
        !err ||
        !err.response ||
        !err.response.headers ||
        typeof err.response.headers['retry-after'] === 'undefined'
    ) {
        return null
    }
    return err.response.headers['retry-after']
}

/**
 * Simple sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch a single page of profile badges (metadata only, no awardedDate)
 * directly from Roblox (no proxy).
 *
 * @param {number} userId
 * @param {string|null} cursor
 * @returns {Promise<{badges: {badgeId:number, placeId:number}[], nextCursor:string|null}>}
 */
async function fetchProfileBadgesPage(userId, cursor) {
    const urlPath = `/users/${userId}/badges`
    const params = {
        limit: 100,
        sortOrder: 'Desc'
    }
    if (cursor) {
        params.cursor = cursor
    }

    const maxAttempts = 5
    let attempt = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
        attempt += 1
        const reqStart = Date.now()
        try {
            const res = await robloxAxios.get(urlPath, {
                params
                //timeout: 15000
            })
            const elapsed = ((Date.now() - reqStart) / 1000).toFixed(3)
            debugLog(
                `[badges] fetchProfileBadgesPage user=${userId} attempt=${attempt} cursor=${cursor || 'null'} took ${elapsed}s`
            )

            const body = res.data || {}
            const data = Array.isArray(body.data) ? body.data : []

            const badges = data.map(b => ({
                badgeId: Number(b.id),
                placeId: b.awarder && typeof b.awarder.id === 'number'
                    ? b.awarder.id
                    : Number(b.awarder && b.awarder.id)
            }))

            return {
                badges,
                nextCursor: body.nextPageCursor || null
            }
        } catch (err) {
            const elapsed = ((Date.now() - reqStart) / 1000).toFixed(3)
            const status = err && err.response && err.response.status
            const retryAfterHeader = getRetryAfter(err)

            if (status === 429) {
                debugWarn(
                    `[badges] Profile badges 429 for user ${userId} attempt=${attempt}, ` +
                    `retry-after=${retryAfterHeader ?? 'none'}, retrying immediately, took ${elapsed}s`
                )
                continue
            }

            debugWarn(
                `[badges] Profile badges request failed for user ${userId} attempt=${attempt} after ${elapsed}s:`,
                err && err.message ? err.message : err
            )
            if (attempt >= maxAttempts) {
                throw err
            }
            //await sleep(1000 * attempt)
        }
    }
}

/**
 * For a list of badge IDs, fetch awarded dates through the proxy.
 * Requests are sent one at a time and retried on failure.
 *
 * @param {number} userId
 * @param {number[]} badgeIds
 * @returns {Promise<Map<number, string>>} Map of badgeId -> awardedDate (ISO string)
 */
async function fetchAwardedDates(userId, badgeIds) {
    const awardedMap = new Map()
    if (!badgeIds.length) return awardedMap

    const idString = badgeIds.join(',')
    const url = `${BADGES_BASE_URL}/users/${userId}/badges/awarded-dates?badgeIds=${idString}`

    const maxAttempts = 5
    const maxLimitAttempts = 5

    let attempt = 0
    let limitAttempt = 0

    // eslint-disable-next-line no-constant-condition
    while (true) {
        attempt += 1
        const reqStart = Date.now()
        try {
            const data = await proxy.get(url)
            const elapsed = ((Date.now() - reqStart) / 1000).toFixed(3)
            debugLog(
                `[badges] fetchAwardedDates user=${userId} attempt=${attempt} count=${badgeIds.length} took ${elapsed}s`
            )
            const arr = data && Array.isArray(data.data) ? data.data : []

            for (const item of arr) {
                if (!item) continue
                const bid = Number(item.badgeId)
                const awardedDate = item.awardedDate
                if (!Number.isFinite(bid) || !awardedDate) continue
                awardedMap.set(bid, awardedDate)
            }
            return awardedMap
        } catch (err) {
            const elapsed = ((Date.now() - reqStart) / 1000).toFixed(3)
            const status = err && err.response && err.response.status
            const retryAfterHeader = getRetryAfter(err)

            if (status === 429) {
                debugWarn(
                    `[badges] Proxy awarded-dates 429 for user ${userId} attempt=${attempt}, ` +
                    `retry-after=${retryAfterHeader ?? 'none'}, retrying immediately, took ${elapsed}s`
                )

                if (limitAttempt >= maxLimitAttempts) {
                    await sleep(60000)
                }
                limitAttempt += 1
                continue
            }

            debugWarn(
                `[badges] Proxy awarded-dates request failed for user ${userId} attempt=${attempt} after ${elapsed}s:`,
                err && err.message ? err.message : err
            )
            if (attempt >= maxAttempts) {
                throw err
            }
            await sleep(1000 * attempt)
        }
    }
}

/**
 * Merge existing badges with a list of new badges, de-duplicating by badgeId
 * and returning them sorted by awardedDate ascending.
 *
 * @param {Badge[]} existing
 * @param {Badge[]} fresh
 * @returns {Badge[]}
 */
function mergeBadges(existing, fresh) {
    const byId = new Map()

    for (const b of existing) {
        if (!b) continue
        const id = Number(b.badgeId)
        if (!Number.isFinite(id)) continue
        byId.set(id, {
            badgeId: id,
            placeId: Number(b.placeId),
            awardedDate: Number(b.awardedDate)
        })
    }

    for (const b of fresh) {
        if (!b) continue
        const id = Number(b.badgeId)
        if (!Number.isFinite(id)) continue
        byId.set(id, {
            badgeId: id,
            placeId: Number(b.placeId),
            awardedDate: Number(b.awardedDate)
        })
    }

    const merged = Array.from(byId.values())
    merged.sort((a, b) => a.awardedDate - b.awardedDate)

    if (merged.length > MAX_BADGES) {
        return merged.slice(merged.length - MAX_BADGES)
    }

    return merged
}

/**
 * Fetch awarded dates for a flat list of badge IDs with limited concurrency
 * by splitting into chunks for the Roblox API.
 *
 * @param {number} userId
 * @param {number[]} badgeIds
 * @param {number} concurrency
 * @returns {Promise<Map<number, string>>} Map of badgeId -> awardedDate (ISO string)
 */
async function fetchAwardedDatesForAll(userId, badgeIds, concurrency) {
    const uniqueIds = Array.from(
        new Set(
            badgeIds
                .map(id => Number(id))
                .filter(Number.isFinite)
        )
    )

    if (!uniqueIds.length) {
        return new Map()
    }

    /** @type {number[][]} */
    const chunks = []
    for (let i = 0; i < uniqueIds.length; i += AWARDED_CHUNK_SIZE) {
        chunks.push(uniqueIds.slice(i, i + AWARDED_CHUNK_SIZE))
    }

    const results = new Array(chunks.length)
    let nextIndex = 0

    async function worker() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const current = nextIndex
            if (current >= chunks.length) {
                break
            }
            nextIndex += 1
            const ids = chunks[current]
            results[current] = await fetchAwardedDates(userId, ids)
        }
    }

    const workerCount = Math.min(concurrency, chunks.length)
    const workers = []
    for (let i = 0; i < workerCount; i++) {
        workers.push(worker())
    }

    await Promise.all(workers)

    const merged = new Map()
    for (const map of results) {
        if (!map) continue
        for (const [id, date] of map.entries()) {
            merged.set(id, date)
        }
    }

    return merged
}

/**
 * Sync a user's badges using the database and Roblox APIs.
 *
 * Flow:
 * 1. Load existing badges from the badges table.
 * 2. Page through the Roblox profile badges endpoint (no proxy), newest first.
 * 3. For each page (in order), find how far into the page is "new".
 *    If the whole page is already known, stop immediately without hitting awarded-dates.
 * 4. For all pages that contain new badges, fetch awarded-dates concurrently with a capped concurrency.
 * 5. Merge and save all new badges back into the DB, then return the full set.
 *
 * @param {number|string} robloxId
 * @returns {Promise<Badge[]>}
 */
async function getUserBadges(robloxId) {
    const startTime = Date.now()
    debugLog('[badges] START getUserBadges', robloxId)
    const userId = Number(robloxId)
    if (!Number.isFinite(userId)) {
        throw new Error(`[badges] Invalid robloxId: ${robloxId}`)
    }

    // 1. Existing data from DB
    const existingBadges = await database.getUserBadges(userId)
    const existingIds = new Set(
        existingBadges
            .map(b => Number(b.badgeId))
            .filter(Number.isFinite)
    )
    debugLog('[badges] DB check', ((Date.now() - startTime) / 1000).toFixed(2))

    /** @type {{pageBadges: {badgeId:number, placeId:number}[], cutoffIndex:number}[]} */
    const pages = []

    // 2. Page through Roblox badges, newest first
    let cursor = null
    let reachedKnownPage = false

    while (!reachedKnownPage) {
        const { badges: pageBadges, nextCursor } = await fetchProfileBadgesPage(userId, cursor)

        if (!pageBadges.length) {
            break
        }

        // Determine cutoff into the page where we hit old badges
        let cutoffIndex = pageBadges.length
        for (let i = 0; i < pageBadges.length; i++) {
            const id = pageBadges[i].badgeId
            if (existingIds.has(id)) {
                cutoffIndex = i
                reachedKnownPage = true
                break
            }
        }

        // If the very first badge is already known, everything older is known
        // so there is nothing new to add and no need to call awarded-dates.
        if (cutoffIndex === 0) {
            break
        }

        pages.push({ pageBadges, cutoffIndex })

        if (!nextCursor || reachedKnownPage) {
            break
        }

        cursor = nextCursor
    }

    debugLog('[badges] Get all badges', ((Date.now() - startTime) / 1000).toFixed(2))

    // If we did not discover any pages with potentially new badges, just return what we have.
    if (!pages.length) {
        return existingBadges
    }

    // Collect all new badge IDs across all pages before hitting awarded-dates
    const allNewIds = []
    const seenNewIds = new Set()

    for (const { pageBadges, cutoffIndex } of pages) {
        for (let i = 0; i < cutoffIndex; i++) {
            const id = Number(pageBadges[i].badgeId)
            if (!Number.isFinite(id)) continue
            if (existingIds.has(id) || seenNewIds.has(id)) continue
            seenNewIds.add(id)
            allNewIds.push(id)
        }
    }

    // No new IDs across all pages, so nothing to update
    if (!allNewIds.length) {
        return existingBadges
    }

    // 4. Fetch awarded dates concurrently for all new IDs with a bounded concurrency level
    const awardedAllMap = await fetchAwardedDatesForAll(userId, allNewIds, 50)
    debugLog('[badges] award dates', ((Date.now() - startTime) / 1000).toFixed(2))

    /** @type {Badge[]} */
    const newBadges = []
    const newIds = new Set()

    // Add new badges from each page using the global awarded-dates map
    for (const { pageBadges, cutoffIndex } of pages) {
        for (let j = 0; j < cutoffIndex; j++) {
            const pb = pageBadges[j]
            const id = Number(pb.badgeId)
            if (!Number.isFinite(id)) continue
            if (existingIds.has(id) || newIds.has(id)) continue

            const awardedIso = awardedAllMap.get(id)
            if (!awardedIso) continue

            const awardedTimestamp = Math.floor(new Date(awardedIso).getTime() / 1000)
            if (!Number.isFinite(awardedTimestamp)) continue

            newBadges.push({
                badgeId: id,
                placeId: Number(pb.placeId),
                awardedDate: awardedTimestamp
            })
            newIds.add(id)
        }
    }

    // 5. Merge, save, and return
    if (newBadges.length > 0) {
        const finalBadges = mergeBadges(existingBadges, newBadges)
        await database.setUserBadges(userId, finalBadges)
        debugLog('[badges] set DB', ((Date.now() - startTime) / 1000).toFixed(2))
        return finalBadges
    }

    return existingBadges
}

const BADGES_BASE_URL = 'https://badges.roblox.com/v1'

const ROBLOX_HTTPS_AGENT = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10
})

const robloxAxios = axios.create({
    baseURL: BADGES_BASE_URL,
    httpsAgent: ROBLOX_HTTPS_AGENT
    //timeout: 15000
})

const MAX_BADGES = 10000
const AWARDED_CHUNK_SIZE = 100

module.exports = {
    getUserBadges
}