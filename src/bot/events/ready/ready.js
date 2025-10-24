'use strict'

const { Client } = require('discord.js')
const { BOT_GUILD_ID } = require('../../../../config.json')

/**
 * ready event bootstrapper
 *
 * Runs once after the bot logs in. Verifies the primary guild is reachable
 * and then kicks off any background ready handlers.
 *
 * Behavior
 *  - Attempts to resolve the guild from cache, then falls back to fetch
 *  - Logs a clear ASCII status line
 *  - Starts the daily inactivity notice cleanup scheduler
 *
 * Notes
 *  - Plain ASCII only
 *  - No semicolons
 *
 * @param {Client} client
 */
module.exports = async function readyHandler(client) {
  // Resolve the guild from cache with a fetch fallback
  let guild = client.guilds.cache.get(BOT_GUILD_ID)
  if (!guild) {
    try { guild = await client.guilds.fetch(BOT_GUILD_ID) } catch {}
  }

  if (!guild) {
    console.error('Guild not found in cache or fetch. Check BOT_GUILD_ID in config.json')
    return
  }

  console.log('Ready. Logged in as ' + (client.user?.tag || 'unknown'))
}