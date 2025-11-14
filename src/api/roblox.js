'use strict'

const noblox = require('noblox.js')
const path = require('path')
const fs = require('fs')

// ----------------------------------------
// In-memory caches
// ----------------------------------------
/** Maps numeric Roblox user id -> username */
const usernameCache = new Map()
/** Maps username -> numeric Roblox user id */
const userIdCache = new Map()

// ----------------------------------------
// Disk cache
// ----------------------------------------
/**
 * We maintain two parallel arrays on disk to keep a simple, human-readable
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
    console.error('roblox.js persist error (usernames):', e && e.message ? e.message : String(e))
  }
  try { fs.writeFileSync(USER_IDS_FILE, JSON.stringify(diskUserIds, null, 2), 'utf8') } catch (e) {
    console.error('roblox.js persist error (userIds):', e && e.message ? e.message : String(e))
  }
}

// ----------------------------------------
// Public API
// ----------------------------------------
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
    console.log('roblox.js fetched username from API:', uname, '(' + idNum + ')')

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
    console.log('roblox.js fetched id from API:', uname, '(' + idNum + ')')

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

module.exports = {
  getUsernameFromId,
  getIdFromUsername
}