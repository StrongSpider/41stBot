'use strict'

const { Client } = require('discord.js')
const { BOT_GUILD_ID } = require('../../../../config.json')

/**
 * @param {Client} client
 */
module.exports = async function readyHandler(client) {
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