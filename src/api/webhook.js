'use strict'

const { WebhookClient, EmbedBuilder } = require('discord.js')
const { ADMIN_LOGS_WEBHOOK_URL } = require('../../config.json')
const roblox = require('./roblox.js')

// Webhook client
let webhookClient = null
try {
  webhookClient = ADMIN_LOGS_WEBHOOK_URL ? new WebhookClient({ url: ADMIN_LOGS_WEBHOOK_URL }) : null
} catch (e) {
  console.error('webhook.js: failed to init WebhookClient:', e && e.message ? e.message : String(e))
  webhookClient = null
}

// Discord embed limits
const MAX_TITLE_LENGTH = 256
const MAX_DESCRIPTION_LENGTH = 4096
const MAX_FIELDS = 25
const MAX_FIELD_NAME = 256
const MAX_FIELD_VALUE = 1024

/**
 * Validate an EmbedBuilder against Discord limits
 * Returns a fallback embed if validation fails.
 * @param {EmbedBuilder} embed
 * @returns {EmbedBuilder}
 */
function validateEmbed(embed) {
  let raw
  try { raw = embed.toJSON() } catch {
    return new EmbedBuilder().setTitle('Too big').setDescription('Invalid embed.').setColor('Red').setTimestamp()
  }

  if (raw.title && raw.title.length > MAX_TITLE_LENGTH) {
    return new EmbedBuilder().setTitle('Too big').setDescription('Embed title exceeds Discord limits.').setColor('Red').setTimestamp()
  }
  if (raw.description && raw.description.length > MAX_DESCRIPTION_LENGTH) {
    return new EmbedBuilder().setTitle('Too big').setDescription('Embed description exceeds Discord limits.').setColor('Red').setTimestamp()
  }
  if (Array.isArray(raw.fields) && raw.fields.length > MAX_FIELDS) {
    return new EmbedBuilder().setTitle('Too big').setDescription('Embed has too many fields.').setColor('Red').setTimestamp()
  }
  if (Array.isArray(raw.fields)) {
    for (const f of raw.fields) {
      const nLength = (f.name || '').length
      const vLength = (f.value || '').length
      if (nLength > MAX_FIELD_NAME || vLength > MAX_FIELD_VALUE) {
        return new EmbedBuilder().setTitle('Too big').setDescription('One of the embed fields exceeds Discord limits.').setColor('Red').setTimestamp()
      }
    }
  }
  return embed
}

/** Safely resolve a Roblox username from id */
async function safeUsername(id) {
  try {
    if (id === null || id === undefined) return 'Unknown'
    if (id === -1) return 'None'
    const name = await roblox.getUsernameFromId(id)
    return name || 'Unknown'
  } catch { return 'Unknown' }
}

/** Send via webhook if configured */
async function safeSend(payload) {
  if (!webhookClient) return
  try { await webhookClient.send(payload) } catch (e) {
    console.error('webhook.js: send failed:', e && e.message ? e.message : String(e))
  }
}

// Event webhooks

/**
 * Send a webhook for event creation
 * @param {{ eventid: string|number, type?: string, host?: number, supervisor?: number, attendees?: number[], message?: string }} entry
 */
async function sendEventCreateWebhook(entry) {
  if (!webhookClient) return
  const { eventid, type, host, supervisor, attendees, message } = entry || {}

  const hostName = await safeUsername(host)
  const supervisorName = await safeUsername(typeof supervisor === 'number' ? supervisor : -1)

  let attendeeNames = []
  if (Array.isArray(attendees) && attendees.length) {
    try { attendeeNames = await Promise.all(attendees.map(id => safeUsername(id))) } catch { attendeeNames = [] }
  }

  let embed = new EmbedBuilder().setTitle('New Event Created: ' + String(eventid)).setColor('Green').setTimestamp()

  if (type) embed.addFields({ name: 'Type', value: String(type), inline: true })
  if (host) embed.addFields({ name: 'Host', value: hostName, inline: true })
  if (supervisor !== undefined && supervisor !== -1) embed.addFields({ name: 'Supervisor', value: supervisorName, inline: true })
  if (attendeeNames.length) embed.addFields({ name: 'Attendees', value: attendeeNames.join(', '), inline: false })
  if (message) embed.addFields({ name: 'Message', value: '[Jump to message](' + String(message) + ')', inline: false })

  embed = validateEmbed(embed)
  await safeSend({ embeds: [embed] })
}

/**
 * Send a webhook for event updates
 * @param {{ eventid: string|number, changedBy: string, changes: Record<string, {from:any, to:any}> }} logEntry
 */
async function sendEventUpdateWebhook(logEntry) {
  if (!webhookClient) return
  const { eventid, changedBy, changes } = logEntry || {}

  const changedKeys = changes && typeof changes === 'object' ? Object.keys(changes) : []
  const changedFieldsList = changedKeys.length ? changedKeys.join(', ') : 'None'

  // Resolve host change names
  let hostChange = null
  if (changes && changes.host) {
    const fromName = await safeUsername(changes.host.from)
    const toName = await safeUsername(changes.host.to)
    hostChange = { from: fromName, to: toName }
  }

  // Resolve supervisor change names
  let supervisorChange = null
  if (changes && changes.supervisor) {
    const fromName = await safeUsername(changes.supervisor.from)
    const toName = await safeUsername(changes.supervisor.to)
    supervisorChange = { from: fromName === 'None' ? null : fromName, to: toName === 'None' ? null : toName }
  }

  // Attendees diff field
  let attendeeDiffField = null
  if (changes && changes.attendees) {
    const oldArr = Array.isArray(changes.attendees.from) ? changes.attendees.from : []
    const newArr = Array.isArray(changes.attendees.to) ? changes.attendees.to : []
    const removed = oldArr.filter(id => !newArr.includes(id))
    const added = newArr.filter(id => !oldArr.includes(id))

    let removedNames = []
    let addedNames = []
    try { removedNames = await Promise.all(removed.map(id => safeUsername(id))) } catch {}
    try { addedNames = await Promise.all(added.map(id => safeUsername(id))) } catch {}

    const parts = []
    if (addedNames.length) parts.push('Added: ' + addedNames.join(', '))
    if (removedNames.length) parts.push('Removed: ' + removedNames.join(', '))
    attendeeDiffField = parts.join('\n')
  }

  let embed = new EmbedBuilder()
    .setTitle('Event Updated: ' + String(eventid))
    .setDescription('Changed by <@' + String(changedBy) + '>\n\n**Fields Changed:** ' + changedFieldsList)
    .setColor('Blue')
    .setTimestamp()

  if (hostChange) embed.addFields({ name: 'Host', value: '**From:** ' + (hostChange.from || 'Unknown') + '\n**To:** ' + (hostChange.to || 'Unknown'), inline: false })
  if (supervisorChange) embed.addFields({ name: 'Supervisor', value: '**From:** ' + (supervisorChange.from || 'None') + '\n**To:** ' + (supervisorChange.to || 'None'), inline: false })
  if (attendeeDiffField) embed.addFields({ name: 'Attendees', value: attendeeDiffField, inline: false })

  if (changes) {
    for (const [key, obj] of Object.entries(changes)) {
      if (key === 'host' || key === 'supervisor' || key === 'attendees') continue
      const from = obj && obj.from !== undefined ? String(obj.from) : 'None'
      const to = obj && obj.to !== undefined ? String(obj.to) : 'None'
      const labelMap = { type: 'Event Type', host: 'Host', supervisor: 'Supervisor', attendees: 'Attendees', message: 'Message', timestamp: 'Timestamp' }
      embed.addFields({ name: labelMap[key] || key, value: '**From:** ' + from + '\n**To:** ' + to, inline: false })
    }
  }

  embed = validateEmbed(embed)
  await safeSend({ embeds: [embed] })
}

/**
 * Send a webhook for event deletions
 * @param {{ eventid: string|number, changedBy: string }} logEntry
 */
async function sendEventDeleteWebhook(logEntry) {
  if (!webhookClient) return
  const { eventid, changedBy } = logEntry || {}

  let embed = new EmbedBuilder()
    .setTitle('Event Deleted: ' + String(eventid))
    .setDescription('Deleted by <@' + String(changedBy) + '>\n\n')
    .setColor('Red')
    .setTimestamp()

  embed = validateEmbed(embed)
  await safeSend({ embeds: [embed] })
}

/**
 * Send a webhook for clearing the weekly database
 * @param {{ discordId: string }} logEntry
 */
async function sendClearWeek(logEntry) {
  if (!webhookClient) return
  const { discordId } = logEntry || {}

  let embed = new EmbedBuilder()
    .setTitle('CLEARED WEEKLY DATABASE')
    .setDescription('Deleted by <@' + String(discordId) + '>\n\n')
    .setColor('Red')
    .setTimestamp()

  embed = validateEmbed(embed)
  await safeSend({ embeds: [embed] })
}

/**
 * Send a webhook for EP updates
 * @param {{ robloxId: number, discordId: string, username?: string, oldPoints: number, newPoints: number }} epEntry
 */
async function sendEPUpdateWebhook(epEntry) {
  if (!webhookClient) return
  const { robloxId, discordId, username, oldPoints, newPoints } = epEntry || {}
  const titleUser = username ? username + ' (' + String(robloxId) + ')' : String(robloxId)

  let embed = new EmbedBuilder()
    .setTitle('EP Updated for ' + titleUser)
    .setDescription('Updated by <@' + String(discordId) + '>')
    .setColor('Blue')
    .setTimestamp()
    .addFields(
      { name: 'Old Points', value: String(oldPoints), inline: true },
      { name: 'New Points', value: String(newPoints), inline: true }
    )

  embed = validateEmbed(embed)
  await safeSend({ embeds: [embed] })
}

/**
 * Send a webhook for a minor log approval action being recorded
 * @param {string} loggerID Discord user id of the staff member
 * @param {string} logMessage URL to the source message
 */
async function sendMinorLogged(loggerID, logMessage) {
  if (!webhookClient) return

  let embed = new EmbedBuilder()
    .setTitle('Minor Officer Log')
    .setDescription('Logged by <@' + String(loggerID) + '>: [link](' + String(logMessage) + ')')
    .setColor('Yellow')
    .setTimestamp()

  embed = validateEmbed(embed)
  await safeSend({ embeds: [embed] })
}

/**
 * Send a plain text webhook notifying a command invocation
 * @param {string} commandName
 * @param {string} discordName
 * @param {string} discordId
 */
async function sendCommandReceived(commandName, discordName, discordId) {
  if (!webhookClient) return
  await safeSend({ content: 'Command `' + String(commandName) + '` received from ' + String(discordName) + ' (' + String(discordId) + ')' })
}

module.exports = {
  sendEventCreateWebhook,
  sendEventUpdateWebhook,
  sendEventDeleteWebhook,
  sendEPUpdateWebhook,
  sendClearWeek,
  sendMinorLogged,
  sendCommandReceived
}
