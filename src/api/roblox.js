'use strict'

const noblox = require('noblox.js')

const LoggerClass = require('./logger.js')
const logger = new LoggerClass('Roblox', 'API')

// DB cache
const database = require('./database')

function normalizeUsername(value) {
  const uname = String(value || '').trim()
  if (!uname || uname.toLowerCase() === 'null') {
    throw new Error('User not found')
  }
  return uname
}

async function fetchUsernameFromApi(idNum) {
  const uname = normalizeUsername(await noblox.getUsernameFromId(idNum))
  logger.info('Fetched username from API: ' + uname + ' (' + idNum + ')')
  return uname
}

async function writeUsernameCache(idNum, username) {
  try {
    await database.upsertUser(idNum, username)
  } catch (err) {
    logger.error('DB write error (upsertUser): ' + err.message)
  }
}

/**
 * Get a Roblox username from a numeric user id
 * Uses the DB cache when present. Missing users are fetched once and
 * written to DB, but existing cached usernames are not refreshed here.
 * @param {number|string} id Roblox user id
 * @returns {Promise<string>} username
 */
const getUsernameFromId = async function (id) {
  const idNum = Number(id)
  if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('Invalid Roblox user id')

  // Check DB
  try {
    const cached = await database.getUserById(idNum)
    if (cached) return cached.username
  } catch (err) {
    logger.error('DB read error (getUsernameFromId): ' + err.message)
  }

  // API fallback
  try {
    const uname = await fetchUsernameFromApi(idNum)
    await writeUsernameCache(idNum, uname)
    return uname
  } catch {
    throw new Error('User not found')
  }
}

/**
 * Explicitly refresh a Roblox username from the API and update DB.
 * Use this from manual refresh flows and the Roblox updater only.
 * @param {number|string} id Roblox user id
 * @returns {Promise<string>} username
 */
const refreshUsernameFromId = async function (id) {
  const idNum = Number(id)
  if (!Number.isFinite(idNum) || idNum <= 0) throw new Error('Invalid Roblox user id')

  try {
    const uname = await fetchUsernameFromApi(idNum)
    await writeUsernameCache(idNum, uname)
    return uname
  } catch {
    throw new Error('User not found')
  }
}

/**
 * Get a Roblox user id from a username
 * Uses the DB cache when present. Missing users are fetched once and
 * written to DB, but existing cached usernames are not refreshed here.
 * @param {string} username Roblox username
 * @returns {Promise<number>} numeric user id
 */
const getIdFromUsername = async function (username) {
  const uname = String(username || '').trim()
  if (!uname) throw new Error('Invalid Roblox username')

  // Check DB
  try {
    const cached = await database.getUserByUsername(uname)
    if (cached) return cached.robloxId
  } catch (err) {
    logger.error('DB read error (getIdFromUsername): ' + err.message)
  }

  // API fallback
  try {
    const idRaw = await noblox.getIdFromUsername(uname)
    const idNum = Number(idRaw)

    // Critical fix: do not upsert null/invalid IDs
    if (!Number.isFinite(idNum) || idNum <= 0) {
      throw new Error('User not found')
    }

    logger.info('Fetched id from API: ' + uname + ' (' + idNum + ')')

    // Update DB
    try {
      await database.upsertUser(idNum, uname)
    } catch (err) {
      logger.error('DB write error (upsertUser): ' + err.message)
    }

    return idNum
  } catch {
    throw new Error('User not found')
  }
}


module.exports = {
  getUsernameFromId,
  refreshUsernameFromId,
  getIdFromUsername,
}
