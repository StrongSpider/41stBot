'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const { getUsernameFromId } = require('../../api/roblox.js')
const { EMBED_COLOR } = require('../../../config.json')
const database = require('../../api/database.js')

/**
 * /event-top command
 *
 * Show the top users for a given event type. Supports a single trailing `*`
 * wildcard for prefix matches, optional time bounds, and host mode.
 *
 * Behavior
 *  - Defaults to weekly scope unless `all-time` is true
 *  - Date bounds are inclusive: after-date at 00:00, before-date at 23:59:59.999
 *  - In host mode, only counts events where user is the host
 *  - Otherwise counts all events associated with the user (attendee or host)
 *
 * Visibility
 *  - Public by default. Error fallbacks use MessageFlags.Ephemeral
 *
 * @file event_top.js
 */

/**
 * Validate an event pattern allowing a single trailing `*` for prefix matches
 * @param {unknown} str
 * @returns {boolean}
 */
function isValidPrefixPattern(str) {
  if (typeof str !== 'string') return false
  if (str === '*') return true // special case: match any
  if (str.length === 0 || str.length > 64) return false
  if (!/[\x20-\x7E]+/.test(str)) return false // printable ASCII only
  if (!/^[A-Za-z0-9._\- *]+$/.test(str)) return false
  const starCount = (str.match(/\*/g) || []).length
  if (starCount === 0) return true
  return starCount === 1 && str.endsWith('*') && str.length > 1
}

/**
 * Convert a validated pattern to a case-insensitive regex
 * @param {string} pattern
 * @returns {RegExp|null}
 */
function toRegex(pattern) {
  if (pattern === '*' || pattern === '') return null
  const hasStar = pattern.endsWith('*')
  const prefix = hasStar ? pattern.slice(0, -1) : pattern
  const escaped = prefix.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped + (hasStar ? '.*' : '') + '$', 'i')
}

/**
 * Parse MM/DD/YYYY into a UTC timestamp ms
 * @param {string|null} input
 * @param {boolean} endOfDay when true, set time to 23:59:59.999
 * @returns {number|null}
 */
function parseBound(input, endOfDay) {
  if (!input) return null
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input)
  if (!m) return null
  const mm = Number(m[1])
  const dd = Number(m[2])
  const yyyy = Number(m[3])
  if (mm < 1 || mm > 12) return null
  const dim = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate()
  if (dd < 1 || dd > dim) return null
  const h = endOfDay ? 23 : 0
  const min = endOfDay ? 59 : 0
  const s = endOfDay ? 59 : 0
  const ms = endOfDay ? 999 : 0
  return Date.UTC(yyyy, mm - 1, dd, h, min, s, ms)
}

module.exports = {
  permission: 'ALL',
  data: new SlashCommandBuilder()
    .setName('event-top')
    .setDescription('Show top users for an event type')
    .addStringOption(option =>
      option
        .setName('event')
        .setDescription('Event type (use * wildcard, e.g. Ranger*)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addBooleanOption(option =>
      option
        .setName('as-host')
        .setDescription('Sort top hosts instead of attendees')
    )
    .addStringOption(option =>
      option
        .setName('before-date')
        .setDescription('Before date (MM/DD/YYYY)')
    )
    .addStringOption(option =>
      option
        .setName('after-date')
        .setDescription('After date (MM/DD/YYYY)')
    )
    .addBooleanOption(option =>
      option
        .setName('all-time')
        .setDescription('Search the all-time database')
    )
    .addIntegerOption(option =>
      option
        .setName('count')
        .setDescription('Users to list (1-15)')
        .setMinValue(1)
        .setMaxValue(15)
    ),

  /**
   * Provide event-type autocomplete from DB
   * @param {import('discord.js').AutocompleteInteraction} interaction
   */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused()
    const { name } = interaction.options.getFocused(true)

    let suggestions = []
    if (name === 'event') {
      const term = String(focused || '').toLowerCase()
      const matches = (await database.getEventTypes())
        .filter(e => !term || e.toLowerCase().startsWith(term))
        .slice(0, 5)
      suggestions = matches.map(e => ({ name: e, value: e }))
    }

    await interaction.respond(suggestions)
  },

  /**
   * Execute the command
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    try {
      await interaction.deferReply()

      const input = interaction.options.getString('event', true)
      const limit = interaction.options.getInteger('count') || 5
      const hostMode = interaction.options.getBoolean('as-host') || false
      const allTimeMode = interaction.options.getBoolean('all-time') || false

      const beforeDateStr = interaction.options.getString('before-date')
      const afterDateStr = interaction.options.getString('after-date')

      // Validate and prepare event matcher
      if (!isValidPrefixPattern(input)) {
        await interaction.editReply({ content: 'Invalid event pattern. Use a name or a single trailing * like `Ranger*`.' })
        return
      }
      const rx = toRegex(input)

      // Inclusive date bounds in UTC
      const afterMs = parseBound(afterDateStr, false)
      const beforeMs = parseBound(beforeDateStr, true)
      if ((afterDateStr && afterMs === null) || (beforeDateStr && beforeMs === null)) {
        await interaction.editReply({ content: 'Invalid date format. Use MM/DD/YYYY.' })
        return
      }

      // Get users to consider based on scope
      const robloxIds = allTimeMode
        ? (await database.getAllUsers().catch(() => [])).map(u => u.robloxId).filter(Boolean)
        : await database.getUsersWithWeeklyEvents().catch(() => [])

      if (!robloxIds || robloxIds.length === 0) {
        await interaction.editReply('No users found to evaluate.')
        return
      }

      // Get per-user event id lists
      const userEvents = allTimeMode
        ? await database.getAllTimeUserEventsBatch(robloxIds).catch(() => [])
        : await database.getWeeklyUserEventsBatch(robloxIds).catch(() => [])

      if (!Array.isArray(userEvents) || userEvents.length === 0) {
        await interaction.editReply(`No logs found for event type \`${input}\`.`)
        return
      }

      // Collect the union of event ids once, then fetch their details in a single batch
      const allEventIds = []
      for (const u of userEvents) {
        if (Array.isArray(u.events)) allEventIds.push(...u.events)
      }
      const uniqIds = Array.from(new Set(allEventIds))
      const eventsArr = await database.getAllTimeEventsBatch(uniqIds).catch(() => [])
      const eventsById = new Map(eventsArr.map(ev => [ev.eventid || ev.id || ev._id || ev.eventId, ev]))

      // Count per user with filters applied
      const counts = []
      for (const u of userEvents) {
        const uid = u.robloxId
        const ids = Array.isArray(u.events) ? u.events : []
        if (!uid || ids.length === 0) continue

        let c = 0
        for (const eid of ids) {
          const ev = eventsById.get(eid)
          if (!ev) continue

          // event type
          const evType = String(ev.type || '')
          const matchType = rx ? rx.test(evType) : true
          if (!matchType) continue

          // host filter
          if (hostMode && ev.host != uid) continue

          // date filter
          if (afterMs !== null || beforeMs !== null) {
            const t = ev.timestamp ? Date.parse(ev.timestamp) : NaN
            if (!Number.isFinite(t)) continue
            if (afterMs !== null && t < afterMs) continue
            if (beforeMs !== null && t > beforeMs) continue
          }

          c++
        }

        if (c > 0) counts.push({ robloxId: uid, count: c })
      }

      if (counts.length === 0) {
        await interaction.editReply(`No logs found for event type \`${input}\`.`)
        return
      }

      counts.sort((a, b) => b.count - a.count)
      const topUsers = counts.slice(0, limit)

      const discordData = await database.getDiscordIdsBatch(topUsers.map(u => u.robloxId)).catch(() => [])
      const idMap = new Map(discordData.map(d => [d.robloxId, d.discordId]))

      const lines = []
      for (let i = 0; i < topUsers.length; i++) {
        const { robloxId, count } = topUsers[i]
        const did = idMap.get(robloxId)
        let tag = did ? `<@${did}>` : null
        if (!tag) {
          try {
            tag = await getUsernameFromId(robloxId)
          } catch {
            tag = '`' + String(robloxId) + '`'
          }
        }
        lines.push(`${i + 1}. ${tag} **${count}**`)
      }

      // Build a human readable date label for the title
      let dateLabel = ''
      if (afterDateStr && beforeDateStr) dateLabel = ` from ${afterDateStr} to ${beforeDateStr}`
      else if (afterDateStr) dateLabel = ` on or after ${afterDateStr}`
      else if (beforeDateStr) dateLabel = ` on or before ${beforeDateStr}`

      const title = `Top ${allTimeMode ? 'All Time' : 'Weekly'} ${topUsers.length} ${hostMode ? 'Hosts' : 'Attendees'} for \`${input}\`${dateLabel}`

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(EMBED_COLOR)
        .setTimestamp()
        .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
        .addFields([{ name: 'Users', value: lines.join('\n') }])

      await interaction.editReply({ embeds: [embed] })
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
      const safe = 'Failed to get event top. ' + msg
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: safe }).catch(() => { })
      } else {
        await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
      }
    }
  }
}