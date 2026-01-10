'use strict'

const noblox = require('noblox.js')
const path = require('path')
const fs = require('fs')

const proxy = require('./proxy.js')
const Logger = require('./logger.js')
const axios = require('axios')

const config = require('../../config.json')

// In-memory caches

/** Maps numeric Roblox user id -> username */
const usernameCache = new Map()
/** Maps username -> numeric Roblox user id */
const userIdCache = new Map()

// Disk cache

/**
 * We maintain two parallel arrays on disk to keep a simple
 * cache that survives restarts. Reads happen once per process. Writes are
 * best effort and only occur when we add new entries.
 */
const CACHE_DIR = path.join(__dirname, '../cache')
const USERNAMES_FILE = path.join(CACHE_DIR, 'usernames.json')
const USER_IDS_FILE = path.join(CACHE_DIR, 'userIds.json')

let diskLoaded = false
let diskUsernames = []
let diskUserIds = []

/**
 * Ensure the on-disk cache is loaded into memory exactly once
 * Creates empty files if missing and tolerates partial or invalid JSON
 */
function ensureDiskCacheLoaded() {
  if (diskLoaded) return

  try { fs.mkdirSync(CACHE_DIR, { recursive: true }) } catch { }

  try {
    const a = fs.existsSync(USERNAMES_FILE) ? fs.readFileSync(USERNAMES_FILE, 'utf8') : '[]'
    const b = fs.existsSync(USER_IDS_FILE) ? fs.readFileSync(USER_IDS_FILE, 'utf8') : '[]'
    const parsedNames = JSON.parse(a)
    const parsedIds = JSON.parse(b)

    // Guard against non-array or mismatched lengths
    const names = Array.isArray(parsedNames) ? parsedNames : []
    const ids = Array.isArray(parsedIds) ? parsedIds : []
    const n = Math.min(names.length, ids.length)
    diskUsernames = names.slice(0, n)
    diskUserIds = ids.slice(0, n)

    // Seed the in-memory maps for quick hits later
    for (let i = 0; i < n; i++) {
      const idNum = Number(diskUserIds[i])
      const uname = String(diskUsernames[i])
      if (Number.isFinite(idNum) && uname) {
        usernameCache.set(idNum, uname)
        userIdCache.set(uname, idNum)
      }
    }
  } catch {
    diskUsernames = []
    diskUserIds = []
  }

  diskLoaded = true
}

/**
 * Persist the current disk arrays to JSON files
 * Best effort only. Failures are logged to console and ignored.
 */
function persistDiskCache() {
  try { fs.writeFileSync(USERNAMES_FILE, JSON.stringify(diskUsernames, null, 2), 'utf8') } catch (e) {
    Logger.error('roblox.js persist error (usernames): ' + (e && e.message ? e.message : String(e)))
  }
  try { fs.writeFileSync(USER_IDS_FILE, JSON.stringify(diskUserIds, null, 2), 'utf8') } catch (e) {
    Logger.error('roblox.js persist error (userIds): ' + (e && e.message ? e.message : String(e)))
  }
}

const INVENTORY_BASE_URL = 'https://inventory.roblox.com/v2'
const GAMES_BASE_URL = 'https://games.roblox.com/v1'

const ROBLOX_COOKIE_HEADER = `.ROBLOSECURITY=${config.ROBLOX_COOKIE}`;
const robloxHttp = axios.create({
  baseURL: GAMES_BASE_URL,
  headers: {
    Cookie: ROBLOX_COOKIE_HEADER
  }
});

/**
 * Simple sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Public API

/**
 * Get a Roblox username from a numeric user id
 * Uses in-memory map, then disk cache, then the Roblox API. On a miss, the
 * result is written back to both caches.
 * @param {number|string} id Roblox user id
 * @returns {Promise<string>} username
 */
const getUsernameFromId = async function (id) {
  ensureDiskCacheLoaded()

  const idNum = Number(id)
  if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('Invalid Roblox user id')

  // Fast path: in-memory map
  if (usernameCache.has(idNum)) return usernameCache.get(idNum)

  // Disk arrays
  const index = diskUserIds.indexOf(idNum)
  if (index !== -1) {
    const uname = String(diskUsernames[index])
    usernameCache.set(idNum, uname)
    userIdCache.set(uname, idNum)
    return uname
  }

  // API fallback
  try {
    const uname = await noblox.getUsernameFromId(idNum)
    Logger.info('roblox.js fetched username from API: ' + uname + ' (' + idNum + ')')

    usernameCache.set(idNum, uname)
    userIdCache.set(uname, idNum)

    diskUsernames.push(uname)
    diskUserIds.push(idNum)
    persistDiskCache()
    return uname
  } catch {
    throw new Error('User not found')
  }
}

/**
 * Get a Roblox user id from a username
 * Uses in-memory map, then disk cache, then the Roblox API. On a miss, the
 * result is written back to both caches.
 * @param {string} username Roblox username
 * @returns {Promise<number>} numeric user id
 */
const getIdFromUsername = async function (username) {
  ensureDiskCacheLoaded()

  const uname = String(username || '').trim()
  if (!uname) throw new Error('Invalid Roblox username')

  // Fast path: in-memory map
  if (userIdCache.has(uname)) return userIdCache.get(uname)

  // Disk arrays
  const index = diskUsernames.indexOf(uname)
  if (index !== -1) {
    const idNum = Number(diskUserIds[index])
    usernameCache.set(idNum, uname)
    userIdCache.set(uname, idNum)
    return idNum
  }

  // API fallback
  try {
    const idNum = await noblox.getIdFromUsername(uname)
    Logger.info('roblox.js fetched id from API: ' + uname + ' (' + idNum + ')')

    usernameCache.set(idNum, uname)
    userIdCache.set(uname, idNum)

    diskUsernames.push(uname)
    diskUserIds.push(idNum)
    persistDiskCache()
    return idNum
  } catch {
    throw new Error('User not found')
  }
}

/**
 * Get place details (name) for a list of place IDs
 * @param {number[]} placeIds
 * @returns {Promise<Map<number, string>>} Map of PlaceID -> PlaceName
 */
const getPlaceDetails = async function (placeIds) {
  const ids = [...new Set(placeIds.filter(id => Number.isFinite(Number(id))))]
  if (ids.length === 0) return new Map()

  const nameMap = new Map()
  const chunkSize = 50 // Generally safer for long URLs

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const query = chunk.map(id => `placeIds=${id}`).join('&')
    const url = `/games/multiget-place-details?${query}`

    try {
      const res = await robloxHttp.get(url)
      const dataArr = Array.isArray(res.data) ? res.data : []
      for (const game of dataArr) {
        if (game && game.placeId && game.name) {
          nameMap.set(Number(game.placeId), String(game.name))
        }
      }
    } catch (err) {
      Logger.warn(`[getPlaceDetails] Failed to fetch chunk starting at index ${i}: ` + err.message)
    }
  }

  return nameMap
}

/**
 * Get friend, follower, and following counts for a user
 * @param {number|string} robloxId 
 * @returns {Promise<{friendCount: number, followingCount: number, followerCount: number}>}
 */
const getConnections = async function (robloxId) {
  const friendCount = await noblox.getFriendCount(robloxId)
  const followingCount = await noblox.getFollowingCount(robloxId)
  const followerCount = await noblox.getFollowerCount(robloxId)

  return {
    friendCount,
    followingCount,
    followerCount
  }
}

// Gamepasses: only GAR gamepasses
/**
 * Get count of GAR gamepasses owned by user
 * @param {number|string} robloxId 
 * @returns {Promise<number>} Count of GAR gamepasses
 */
const getUserGamepasses = async function (robloxId) {
  const userId = Number(robloxId)
  if (!Number.isFinite(userId)) {
    throw new Error(`[gamepasses] Invalid robloxId: ${robloxId}`)
  }

  // Only count GAR gamepasses (for a specific GAR game) owned by the user.
  const GAR_GAME_ID = 1383204830

  /** @type {number[]} */
  const garPassIds = []
  let cursor = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const queryParts = ['limit=100', 'sortOrder=Asc']
    if (cursor) {
      queryParts.push(`cursor=${encodeURIComponent(cursor)}`)
    }
    const query = queryParts.join('&')
    const url = `${GAMES_BASE_URL}/games/${GAR_GAME_ID}/game-passes?${query}`

    const maxAttempts = 5
    let attempt = 0
    let page

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1
      try {
        page = await proxy.get(url)
        break
      } catch (err) {
        const status = err && err.response && err.response.status
        const retryAfterHeader =
          err &&
          err.response &&
          err.response.headers &&
          err.response.headers['retry-after']

        if (status === 429) {
          Logger.warn(
            `[gamepasses] GAR passes 429 for game ${GAR_GAME_ID} attempt=${attempt}, ` +
            `retry-after=${retryAfterHeader ?? 'none'}, retrying immediately`
          )
          continue
        }

        Logger.warn(
          `[gamepasses] GAR passes request failed for game ${GAR_GAME_ID} attempt=${attempt}: ` +
          (err && err.message ? err.message : err)
        )
        if (attempt >= maxAttempts) {
          throw err
        }
        await sleep(1000 * attempt)
      }
    }

    const body = page || {}
    const dataArr = Array.isArray(body.data) ? body.data : []
    for (const pass of dataArr) {
      if (!pass || typeof pass !== 'object') continue
      const id = Number(pass.id)
      if (!Number.isFinite(id)) continue
      garPassIds.push(id)
    }

    if (!body.nextPageCursor) {
      break
    }
    cursor = body.nextPageCursor
  }

  let garGamepasses = 0

  if (garPassIds.length > 0) {
    const ids = garPassIds.slice()
    let nextIndex = 0
    const maxAttemptsOwnership = 5

    async function ownershipWorker() {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const current = nextIndex
        if (current >= ids.length) break
        nextIndex += 1
        const passId = ids[current]

        const url = `${INVENTORY_BASE_URL}/users/${userId}/items/1/${passId}`
        let attempt = 0

        // eslint-disable-next-line no-constant-condition
        while (true) {
          attempt += 1
          try {
            const body = await proxy.get(url)
            const dataArr = Array.isArray(body.data) ? body.data : []
            if (dataArr.length > 0) {
              garGamepasses += 1
            }
            break
          } catch (err) {
            const status = err && err.response && err.response.status
            const retryAfterHeader =
              err &&
              err.response &&
              err.response.headers &&
              err.response.headers['retry-after']

            if (status === 429) {
              Logger.warn(
                `[gamepasses] ownership 429 for user ${userId} passId=${passId} attempt=${attempt}, ` +
                `retry-after=${retryAfterHeader ?? 'none'}, retrying immediately`
              )
              continue
            }

            Logger.warn(
              `[gamepasses] ownership request failed for user ${userId} passId=${passId} attempt=${attempt}: ` +
              (err && err.message ? err.message : err)
            )
            if (attempt >= maxAttemptsOwnership) {
              break
            }
            await sleep(1000 * attempt)
          }
        }
      }
    }

    const workerCount = Math.min(5, ids.length)
    const workers = []
    for (let i = 0; i < workerCount; i++) {
      workers.push(ownershipWorker())
    }
    await Promise.all(workers)
  }

  // Return only the GAR gamepass count
  return garGamepasses
}

/**
 * Check if a user's inventory is viewable
 * @param {number|string} robloxId 
 * @returns {Promise<boolean>}
 */
const canViewInventory = async function (robloxId) {
  const url = `https://inventory.roblox.com/v1/users/${robloxId}/can-view-inventory`

  const maxAttempts = 5
  let attempt = 0
  let page

  while (true) {
    attempt += 1
    try {
      page = await proxy.get(url)
      break
    } catch (err) {
      const status = err && err.response && err.response.status
      const retryAfterHeader =
        err &&
        err.response &&
        err.response.headers &&
        err.response.headers['retry-after']

      if (status === 429) {
        Logger.warn(
          `[gamepasses] GAR passes 429 for game ${GAR_GAME_ID} attempt=${attempt}, ` +
          `retry-after=${retryAfterHeader ?? 'none'}, retrying immediately`
        )
        continue
      }

      Logger.warn(
        `[gamepasses] GAR passes request failed for game ${GAR_GAME_ID} attempt=${attempt}: ` +
        (err && err.message ? err.message : err)
      )
      if (attempt >= maxAttempts) {
        throw err
      }
      await sleep(1000 * attempt)
    }
  }

  return page.data.canView
}

module.exports = {
  getUsernameFromId,
  getIdFromUsername,
  getUserProfile: noblox.getUserInfo,
  getConnections,

  getUserGamepasses,
  canViewInventory,
  getPlaceDetails
}