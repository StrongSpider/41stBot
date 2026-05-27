'use strict'

const { Client, ActivityType } = require('discord.js')
const { listAllTimeEvents } = require('../../../api/database')

const LoggerClass = require('../../../api/logger.js')
const logger = new LoggerClass('BotStatus', 'BOT')

const INTERVAL_MS = 15 * 60 * 1000

/**
 * Update the bot presence with the current total event count
 * @param {Client} client
 */
async function updateEventStatus(client) {
  if (!client || !client.user) return

  let events
  try { events = await listAllTimeEvents() } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    logger.error('Failed to list events: ' + msg)
    return
  }

  if (!Array.isArray(events)) {
    logger.error('listAllTimeEvents did not return an array')
    return
  }

  const count = events.length

  try {
    await client.user.setPresence({
      activities: [{ name: 'Logged ' + count.toLocaleString() + ' events', type: ActivityType.Playing }],
      status: 'online'
    })
  } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    logger.error('Failed to set presence: ' + msg)
  }
}

/**
 * @param {Client} client
 */
module.exports = async function handleEventStatusReady(client) {
  await updateEventStatus(client)

  // prevent duplicate intervals if ready fires again for any reason
  if (client.__eventStatusInterval) clearInterval(client.__eventStatusInterval)

  client.__eventStatusInterval = setInterval(() => {
    updateEventStatus(client).catch(() => { })
  }, INTERVAL_MS)
}