

const fs = require('fs')
const path = require('path')
const axios = require('axios')

const config = require('../../config.json')

const key = config.TRELLO_API_KEY
const token = config.TRELLO_TOKEN

if (!key || !token) {
  throw new Error('TRELLO_API_KEY or TRELLO_TOKEN missing from config.json')
}

// Where we store the cached blacklist data on disk
const CACHE_PATH = path.join(__dirname, '../cache/blacklists.json')

// In-memory copy so repeated getBlacklists calls do not keep hitting the disk
let cacheMemory = null

function ensureCacheDir() {
  const dir = path.dirname(CACHE_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Extract Roblox user id from a Trello card description.
 * Matches:
 *   https://www.roblox.com/users/123456/profile
 *   https://www.roblox.com/users/123456
 */
function extractRobloxIdFromDesc(desc) {
  if (!desc) return null
  const match = desc.match(/https:\/\/www\.roblox\.com\/users\/(\d+)(?:\/profile)?/i)
  return match ? match[1] : null
}

/**
 * Given a Trello card and a map of listId -> listName,
 * build a processed blacklist entry or return null if the card
 * should be ignored (no roblox id, denied, etc.).
 */
function buildBlacklistEntry(card, listMap) {
  if (!card) return null

  const robloxId = extractRobloxIdFromDesc(card.desc)
  if (!robloxId) return null

  const labels = Array.isArray(card.labels) ? card.labels : []
  const labelNames = labels.map(label => label.name).filter(Boolean)

  // Skip cards that have a "Denied" label
  if (labelNames.some(name => /denied/i.test(name))) {
    return null
  }

  const listName = card.idList && listMap[card.idList] ? listMap[card.idList] : 'Unknown Category'

  // Category: use the Trello list name
  const category = listName || 'Unknown Category'

  // Duration: Permanent or Expires based on labels
  let duration = 'Unknown Duration'
  if (labelNames.some(name => /permanent/i.test(name))) {
    duration = 'Permanent'
  } else if (labelNames.some(name => /expires?|temporary/i.test(name))) {
    duration = 'Expires'
  }

  // Appeal status: Appealable or Non Appealable based on labels
  let appealStatus = 'Unknown Appeal Status'
  if (labelNames.some(name => /not appealable/i.test(name))) {
    appealStatus = 'Non Appealable'
  } else if (labelNames.some(name => /appealable/i.test(name))) {
    appealStatus = 'Appealable'
  }

  if (!card.url) return null

  const summary = `${category} | ${duration} | ${appealStatus}`
  const markdownLink = `[${summary}](${card.url})`

  return {
    robloxId,
    cardId: card.id,
    category,
    duration,
    appealStatus,
    url: card.url,
    markdown: markdownLink
  }
}

/**
 * Load blacklist cache JSON from disk into memory.
 * Returns null if cache file does not exist or is invalid.
 */
function loadCacheFromDisk() {
  try {
    const data = fs.readFileSync(CACHE_PATH, 'utf8')
    const parsed = JSON.parse(data)
    return parsed
  } catch {
    return null
  }
}

/**
 * Save cache JSON object to disk and update the in-memory copy.
 */
function saveCacheToDisk(cacheObj) {
  ensureCacheDir()
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheObj, null, 2), 'utf8')
  cacheMemory = cacheObj
}

/**
 * Public: updateCache(boardId)
 *
 * Fetches the entire Trello board (lists + all cards, including archived),
 * processes the blacklist info and stores it in a JSON cache on disk.
 *
 * boardId can be either the short board id from the Trello URL (e.g. "AuCZZmej")
 * or the full Trello ID. The caller is responsible for passing the right id.
 */
async function updateCache(boardId) {
  if (!boardId) {
    throw new Error('boardId is required for updateCache')
  }

  // Fetch lists for category names
  const listsRes = await axios.get(`https://api.trello.com/1/boards/${boardId}/lists`, {
    params: {
      key,
      token,
      fields: 'name'
    }
  })

  const listMap = {}
  for (const list of listsRes.data || []) {
    if (list && list.id) {
      listMap[list.id] = list.name
    }
  }

  // Fetch all cards (open + archived) on the board
  const cardsRes = await axios.get(`https://api.trello.com/1/boards/${boardId}/cards`, {
    params: {
      key,
      token,
      filter: 'all',
      fields: 'name,desc,url,labels,idList'
    }
  })

  const entriesByRobloxId = {}

  for (const card of cardsRes.data || []) {
    const entry = buildBlacklistEntry(card, listMap)
    if (!entry) continue

    if (!entriesByRobloxId[entry.robloxId]) {
      entriesByRobloxId[entry.robloxId] = []
    }
    entriesByRobloxId[entry.robloxId].push(entry)
  }

  const cacheObj = {
    updatedAt: new Date().toISOString(),
    boardId,
    entriesByRobloxId
  }

  saveCacheToDisk(cacheObj)

  return cacheObj
}

/**
 * Ensure we have a cache loaded in memory.
 * If the in-memory copy is empty, try reading from disk.
 */
function ensureCacheLoaded() {
  if (cacheMemory) {
    return cacheMemory
  }
  cacheMemory = loadCacheFromDisk()
  return cacheMemory
}

/**
 * Public: getBlacklists(robloxId)
 *
 * Looks up all blacklist entries for the given robloxId in the cache
 * and returns an array of markdown strings, one for each card.
 *
 * If the cache is missing or the robloxId has no entries, returns [].
 */
function getBlacklists(robloxId) {
  if (!robloxId) return []

  const cache = ensureCacheLoaded()
  if (!cache || !cache.entriesByRobloxId) {
    return []
  }

  const keyId = String(robloxId)
  const entries = cache.entriesByRobloxId[keyId] || []

  return entries.map(entry => entry.markdown)
}

module.exports = {
  updateCache,
  getBlacklists,
}