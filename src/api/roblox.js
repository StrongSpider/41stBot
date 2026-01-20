'use strict'

const noblox = require('noblox.js')
const proxy = require('./proxy.js')
const Logger = require('./logger.js')
const axios = require('axios')

const config = require('../../config.json')

// DB cache
const db = require('./db')

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

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

/**
 * Get a Roblox username from a numeric user id
 * Uses DB cache, then the Roblox API. On a miss, the
 * result is written back to DB.
 * @param {number|string} id Roblox user id
 * @returns {Promise<string>} username
 */
const getUsernameFromId = async function (id) {
  const idNum = Number(id)
  if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('Invalid Roblox user id')

  // Check DB
  try {
    const cached = await db.getUserById(idNum)
    if (cached) {
      if (Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL_MS) {
        return cached.username
      }
    }
  } catch (err) {
    Logger.error('roblox.js DB read error (getUsernameFromId): ' + err.message)
  }

  // API fallback
  try {
    const uname = await noblox.getUsernameFromId(idNum)
    Logger.info('roblox.js fetched username from API: ' + uname + ' (' + idNum + ')')

    // Update DB
    try {
      await db.upsertUser(idNum, uname)
    } catch (err) {
      Logger.error('roblox.js DB write error (upsertUser): ' + err.message)
    }

    return uname
  } catch {
    throw new Error('User not found')
  }
}

/**
 * Get a Roblox user id from a username
 * Uses DB cache, then the Roblox API. On a miss, the
 * result is written back to DB.
 * @param {string} username Roblox username
 * @returns {Promise<number>} numeric user id
 */
const getIdFromUsername = async function (username) {
  const uname = String(username || '').trim()
  if (!uname) throw new Error('Invalid Roblox username')

  // Check DB
  try {
    const cached = await db.getUserByUsername(uname)
    if (cached) {
      if (Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL_MS) {
        return cached.robloxId
      }
    }
  } catch (err) {
    Logger.error('roblox.js DB read error (getIdFromUsername): ' + err.message)
  }

  // API fallback
  try {
    const idNum = await noblox.getIdFromUsername(uname)
    Logger.info('roblox.js fetched id from API: ' + uname + ' (' + idNum + ')')

    // Update DB
    try {
      await db.upsertUser(idNum, uname)
    } catch (err) {
      Logger.error('roblox.js DB write error (upsertUser): ' + err.message)
    }

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