'use strict'

const noblox = require('noblox.js')

const LoggerClass = require('./logger.js')
const logger = new LoggerClass('Roblox', 'API')

// DB cache
const db = require('./db')

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

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
    logger.error('DB read error (getUsernameFromId): ' + err.message)
  }

  // API fallback
  try {
    const unameRaw = await noblox.getUsernameFromId(idNum)
    const uname = String(unameRaw || '').trim()
    if (!uname || uname.toLowerCase() === 'null') {
      throw new Error('User not found')
    }

    logger.info('Fetched username from API: ' + uname + ' (' + idNum + ')')

    // Update DB (only if values are valid)
    try {
      await db.upsertUser(idNum, uname)
    } catch (err) {
      logger.error('DB write error (upsertUser): ' + err.message)
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
      await db.upsertUser(idNum, uname)
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
  getIdFromUsername,
}