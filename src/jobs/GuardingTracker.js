'use strict'

const { WebhookClient, EmbedBuilder } = require('discord.js')
const Logger = require('../api/logger.js')
const noblox = require('noblox.js')
const cookieManager = require('../api/cookieManager.js')

const config = require('../../config.json')
const { GROUP_ID: ROBLOX_GROUP_ID, GROUP_GUARDING_RANKS: ROBLOX_GROUP_GUARDING_RANKS, PLACE_ID: ROBLOX_PLACE_ID } = config.ROBLOX
const { GUARDING_TRACKER: GUARDING_TRACKER_WEBHOOK_URL } = config.DISCORD.WEBHOOKS
const { VIP_PING: DISCORD_VIP_PING_ROLE_ID } = config.DISCORD.ROLES

/**
 * GuardingTracker
 *
 * Monitors Roblox presences for a set of VIP users and sends webhook
 * messages when a VIP joins or leaves the target place.
 *
 * Behavior
 *  - Loads VIPs from a Roblox group and a list of allowed ranks
 *  - Polls user presences at a fixed interval
 *  - Tracks last known in-place state per user to emit only transitions
 *  - Sends concise ASCII embeds to a Discord webhook
 *
 * Notes
 *  - Uses best-effort API calls with try/catch around network operations
 */

// Minutes between presence checks
const MINUTES_BETWEEN_CHECKS = 1
const MINUTES_BETWEEN_PING = 60
const MINUTES_BETWEEN_VIP_REFRESH = 30

const logger = new Logger('GuardingTracker', 'BOT')

let lastPing = 0

// Loaded once from the group, objects like { userid, username, rank }
const VIP_USERS = []

// Map of userId -> boolean (true when currently in the place)
const VIP_STATUS = {}

// Webhook client (optional). If URL is missing or invalid, we log and no-op.
let webhook = null
try {
  if (GUARDING_TRACKER_WEBHOOK_URL && typeof GUARDING_TRACKER_WEBHOOK_URL === 'string') {
    webhook = new WebhookClient({ url: GUARDING_TRACKER_WEBHOOK_URL })
  } else {
    logger.warn('GUARDING_TRACKER_WEBHOOK_URL is not set')
  }
} catch (e) {
  logger.error('failed to init webhook client:', e && e.message ? e.message : String(e))
}

// Simple sleep helper
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Fetch a Roblox headshot URL for a user
 * @param {number} userid
 * @returns {Promise<string|undefined>}
 */
async function getHeadshotUrl(userid) {
  try {
    const thumbs = await noblox.getPlayerThumbnail(userid, 420, 'png', false, 'headshot')
    const first = Array.isArray(thumbs) ? thumbs[0] : null
    return first && first.imageUrl ? first.imageUrl : undefined
  } catch {
    return undefined
  }
}

/**
 * Send a VIP presence transition message
 * @param {{ userId: number }} presence
 * @param {'join'|'leave'} action
 */
async function sendVipMessage(presence, action) {
  if (!webhook) return

  const userid = presence.userId
  const user = VIP_USERS.find(u => u.userid === userid)
  const imageUrl = await getHeadshotUrl(userid)

  const embed = new EmbedBuilder()
    .setTimestamp()
    .setTitle(action === 'join' ? 'A VIP has joined Coruscant' : 'A VIP has left Coruscant')
    .setColor(action === 'join' ? 'Green' : 'Red')
    .addFields(
      { name: 'Rank:', value: user?.rank ?? 'Unknown', inline: true },
      { name: 'Profile:', value: `[${user?.username ?? 'User'}](https://www.roblox.com/users/${userid}/profile)`, inline: true }
    )

  if (imageUrl) embed.setThumbnail(imageUrl)

  try {
    const currentMS = Date.now()

    let content = ""
    if ((lastPing + MINUTES_BETWEEN_PING * 60 * 1000) < currentMS && action === 'join') {
      lastPing = currentMS
      content = `<@&${DISCORD_VIP_PING_ROLE_ID}>`
    }
    await webhook.send({ embeds: [embed], content })
  } catch (e) {
    logger.error('webhook send failed:', e && e.message ? e.message : String(e))
  }
}

/**
 * Fetch all members of a Roblox group with pagination
 * Returns array of { userid, username, rank }
 */
async function fetchGroupMembers(groupId) {
  let cursor = ''
  const members = []

  while (true) {
    try {
      const apiRequest = await fetch(`https://groups.roblox.com/v1/groups/${groupId}/users?limit=100&sortOrder=Asc&cursor=${cursor}`)
      if (!apiRequest.ok) break
      const data = await apiRequest.json()

      cursor = data.nextPageCursor || ''
      const items = Array.isArray(data.data) ? data.data : []
      for (const entry of items) {
        members.push({
          userid: entry?.user?.userId,
          username: entry?.user?.username,
          rank: entry?.role?.name
        })
      }

      if (!cursor) break
    } catch {
      break
    }
  }

  // Filter out any partial rows
  return members.filter(m => typeof m.userid === 'number' && m.username && m.rank)
}

/**
 * Populate VIP_USERS from the configured group and allowed ranks
 */
async function preloadVIPs() {
  const allowed = new Set(Array.isArray(ROBLOX_GROUP_GUARDING_RANKS) ? ROBLOX_GROUP_GUARDING_RANKS : [])
  const groupMembers = await fetchGroupMembers(ROBLOX_GROUP_ID)
  const vipMembers = groupMembers.filter(m => allowed.has(m.rank))

  VIP_USERS.length = 0
  for (const m of vipMembers) VIP_USERS.push(m)

  logger.debug('loaded VIPs', VIP_USERS.length)
}

/**
 * Poll presences and emit join or leave messages on transitions
 */
async function runChecks() {
  if (VIP_USERS.length === 0) return

  const userIds = VIP_USERS.map(u => u.userid)
  let presences
  try {
    presences = await noblox.getPresences(userIds)
  } catch (e) {
    logger.error('getPresences failed:', e && e.message ? e.message : String(e))
    return
  }

  const list = presences && Array.isArray(presences.userPresences) ? presences.userPresences : []
  const targetPlaceId = Number(ROBLOX_PLACE_ID)

  for (const presence of list) {
    const uid = presence?.userId
    if (!uid) continue

    const inTarget = Number(presence.placeId) === targetPlaceId

    // First sighting: initialize without emitting
    if (typeof VIP_STATUS[uid] === 'undefined') {
      VIP_STATUS[uid] = inTarget
      continue
    }

    // Transition detection
    const wasIn = Boolean(VIP_STATUS[uid])
    if (inTarget && !wasIn) {
      VIP_STATUS[uid] = true
      await sendVipMessage(presence, 'join')
    } else if (!inTarget && wasIn) {
      VIP_STATUS[uid] = false
      await sendVipMessage(presence, 'leave')
    }
  }

  logger.debug('status snapshot', VIP_STATUS)
}

/**
 * Program entry point
 *  - Authenticates to Roblox
 *  - Loads VIP list
 *  - Enters polling loop
 */
async function main() {
  // Initialize noblox with current cookie from manager
  await noblox.setCookie(cookieManager.getCookie())
  let lastCookieSync = Date.now()

  try {
    await preloadVIPs()
    let lastVipRefresh = Date.now()

    while (true) {
      // Periodic cookie sync (check if Set-Cookie header updated the cookie)
      // Periodically refresh noblox's cookie in case it was updated via Set-Cookie headers
      if (Date.now() - lastCookieSync > 10 * 60 * 1000) { // Every 10 minutes
        try {
          const currentCookie = cookieManager.getCookie()
          if (currentCookie) {
            await noblox.setCookie(currentCookie)
            lastCookieSync = Date.now()
            logger.debug('Synced cookie with noblox.js')
          }
        } catch (e) {
          logger.warn('Failed to sync cookie with noblox:', e && e.message ? e.message : String(e))
        }
      }

      // Periodic VIP list refresh
      if (Date.now() - lastVipRefresh > MINUTES_BETWEEN_VIP_REFRESH * 60 * 1000) {
        try {
          logger.debug('Refreshing VIP list...')
          await preloadVIPs()
          lastVipRefresh = Date.now()
        } catch (e) {
          logger.error('Failed to refresh VIP list:', e && e.message ? e.message : String(e))
        }
      }

      try { await runChecks() } catch (e) {
        logger.error('runChecks error:', e && e.message ? e.message : String(e))
      }

      logger.debug('waiting', MINUTES_BETWEEN_CHECKS, 'minute before next check')
      await sleep(MINUTES_BETWEEN_CHECKS * 60 * 1000)
    }
  } catch (err) {
    logger.error('fatal error:', err && err.message ? err.message : String(err))
    process.exit(1)
  }
}

main()
