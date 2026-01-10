'use strict'

const database = require('./database.js')
const Logger = require('./logger.js')
const config = require('../../config.json')
const { default: axios } = require('axios')

const https = require('https')

const DEBUG_ASSETS = false
const logger = new Logger('Assets', 'API')

function debugAssets(...args) {
  if (!DEBUG_ASSETS) return
  logger.debug(...args)
}

/**
 * @typedef {import('./database.js').Asset} Asset
 */

const INVENTORY_BASE_URL = 'https://inventory.roblox.com/v2'
const MAX_ASSETS = 10000

const INVENTORY_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10
})

const inventoryAxios = axios.create({
  baseURL: INVENTORY_BASE_URL,
  httpsAgent: INVENTORY_HTTPS_AGENT
  //timeout: 15000
})

/**
 * Simple sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch and sync a user's inventory assets.
 *
 * Behavior:
 * - Uses config.ROBLOX_ASSET_TYPES.{DEVELOPMENT, AVATAR} to decide which asset types to pull.
 * - Pages newest-first through the Roblox inventory API via proxy.get.
 * - Stops paging early if it encounters an assetId that already exists in the DB snapshot,
 *   then merges new IDs with the old snapshot.
 * - Respects a global hard cap of MAX_ASSETS across existing + new assets.
 *
 * @param {number|string} robloxId
 * @param {{ overwriteExisting?: boolean }} [options]
 * @returns {Promise<Asset[]>}
 */
const getAssetsInformation = async function (robloxId, options) {
  const userId = Number(robloxId)
  if (!Number.isFinite(userId)) {
    throw new Error(`[assets] Invalid robloxId: ${robloxId}`)
  }

  const overwriteExisting = !!(options && options.overwriteExisting)

  debugAssets('start getAssetsInformation for userId=', userId, 'overwriteExisting=', overwriteExisting)

  /** @type {Asset[]} */
  let existingAssets = []
  /** @type {Map<number, Asset>} */
  const existingMap = new Map()

  if (!overwriteExisting) {
    // Load existing assets from DB so we can diff and avoid unnecessary work
    existingAssets = await database.getUserAssets(userId)
    debugAssets('loaded existing assets from DB:', existingAssets ? existingAssets.length : 0)
    for (const a of existingAssets) {
      if (!a || typeof a !== 'object') continue
      const id = Number(a.assetId)
      if (!Number.isFinite(id)) continue
      const type = typeof a.type === 'string' ? a.type : ''
      existingMap.set(id, {
        type,
        assetId: id
      })
    }
  } else {
    debugAssets('overwriteExisting enabled, skipping load of existing DB snapshot')
  }

  const existingIds = new Set(existingMap.keys())

  const devTypes = Array.isArray(config.ROBLOX_ASSET_TYPES && config.ROBLOX_ASSET_TYPES.DEVELOPMENT)
    ? config.ROBLOX_ASSET_TYPES.DEVELOPMENT
    : []
  const avatarTypes = Array.isArray(config.ROBLOX_ASSET_TYPES && config.ROBLOX_ASSET_TYPES.AVATAR)
    ? config.ROBLOX_ASSET_TYPES.AVATAR
    : []
  const allTypes = [...devTypes, ...avatarTypes].filter(t => typeof t === 'string' && t)
  debugAssets('devTypes:', devTypes, 'avatarTypes:', avatarTypes, 'allTypes:', allTypes)
  if (!allTypes.length) {
    debugAssets('no asset types configured, returning existing assets')
    return existingAssets
  }
  const assetTypesParam = allTypes.join(',')
  debugAssets('assetTypesParam:', assetTypesParam)

  /** @type {Map<number, Asset>} */
  const byId = new Map()

  let cursor = null
  let reachedKnown = false

  // Phase 1: page through inventory and collect assetId + type
  // eslint-disable-next-line no-constant-condition
  while (true) {
    debugAssets('paging inventory, current cursor=', cursor)
    const params = {
      assetTypes: assetTypesParam,
      limit: 100,
      sortOrder: 'Desc'
    }
    if (cursor) {
      params.cursor = cursor
    }
    const urlPath = `/users/${userId}/inventory`

    const maxAttempts = 5
    let attempt = 0
    let page

    // eslint-disable-next-line no-constant-condition
    while (true) {
      debugAssets('inventory request attempt start', { userId, cursor, attempt })
      attempt += 1
      try {
        page = (await inventoryAxios.get(urlPath, { params })).data
        debugAssets('inventory request success', { userId, cursor, attempt, count: page && Array.isArray(page.data) ? page.data.length : 0 })
        break
      } catch (err) {
        const status = err && err.response && err.response.status
        const retryAfterHeader =
          err &&
          err.response &&
          err.response.headers &&
          err.response.headers['retry-after']

        if (status === 429) {
          debugAssets('inventory 429 received', { userId, attempt, retryAfter: retryAfterHeader })
          logger.warn(
            `inventory 429 for user ${userId} attempt=${attempt}, ` +
            `retry-after=${retryAfterHeader ?? 'none'}, retrying immediately`
          )
          continue
        }

        if (status === 403) {
          throw new Error("Inventory private")
        }

        logger.warn(
          `inventory request failed for user ${userId} attempt=${attempt}:`,
          err && err.message ? err.message : err
        )
        if (attempt >= maxAttempts) {
          throw err
        }
        //await sleep(1000 * attempt)
      }
    }

    const body = page || {}
    const dataArr = Array.isArray(body.data) ? body.data : []
    debugAssets('processing inventory page', { userId, cursor, items: dataArr.length })

    for (const item of dataArr) {
      if (!item || typeof item !== 'object') continue
      const assetId = Number(item.assetId)
      if (!Number.isFinite(assetId)) continue

      // If we hit an ID that already exists in the DB snapshot,
      // stop here and treat everything we saw before as "new".
      if (existingIds.has(assetId)) {
        debugAssets('hit known assetId, stopping paging', { userId, assetId })
        reachedKnown = true
        break
      }

      const type =
        typeof item.assetType === 'string'
          ? item.assetType
          : typeof item.assetTypeName === 'string'
            ? item.assetTypeName
            : ''

      /** @type {Asset} */
      const asset = {
        type,
        assetId
      }
      byId.set(assetId, asset)
      debugAssets('added new asset from inventory', { userId, assetId, type })

      // Respect global cap across existing + new
      if (byId.size + existingIds.size >= MAX_ASSETS) {
        debugAssets('reached MAX_ASSETS cap, stopping paging', { userId, totalNew: byId.size, totalExisting: existingIds.size })
        reachedKnown = true
        break
      }
    }

    if (!body.nextPageCursor || byId.size >= MAX_ASSETS || reachedKnown) {
      break
    }
    cursor = body.nextPageCursor
  }

  debugAssets('finished paging inventory', { userId, newAssets: byId.size, reachedKnown, existing: existingIds.size })

  // Nothing found: either inventory is empty or everything we saw was known.
  // If we already have DB state and we hit a known ID, just reuse it.
  if (byId.size === 0) {
    if (existingAssets && existingAssets.length && reachedKnown) {
      debugAssets('no new assets, reusing existing snapshot', { userId, existing: existingAssets.length })
      return existingAssets
    }
    debugAssets('no assets found at all, clearing DB snapshot', { userId })
    await database.setUserAssets(userId, [])
    return []
  }

  // If we never hit a known ID, treat this as a full refresh snapshot.
  if (!reachedKnown) {
    const assets = Array.from(byId.values())
    debugAssets('full refresh, replacing existing assets in DB', { userId, count: assets.length })
    await database.setUserAssets(userId, assets)
    return assets
  }

  // We hit an existing ID: combine old IDs with new ones we just discovered.
  // Existing snapshot comes first, then append any truly new IDs.
  debugAssets('merging existing and new assets', { userId, existing: existingAssets.length, newCandidates: byId.size })
  const mergedAssets = existingAssets.concat(
    Array.from(byId.values()).filter(a => !existingMap.has(a.assetId))
  )

  debugAssets('writing merged assets to DB and returning', { userId, mergedCount: mergedAssets.length })
  await database.setUserAssets(userId, mergedAssets)
  return mergedAssets
}

module.exports = {
  getAssetsInformation
}
