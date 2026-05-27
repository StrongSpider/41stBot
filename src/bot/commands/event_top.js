'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const { getUsernameFromId } = require('../../api/roblox.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const database = require('../../api/database')
const { resolveEventDateFilters, eventMatchesDateRange } = require('../utils/eventDateFilters')
const { respondWithEventTypeAutocomplete } = require('../utils/eventTypeAutocomplete')

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

module.exports = {
  permission: 'ALL',
  data: new SlashCommandBuilder()
    .setName('event-top')
    .setDescription('Show the top users for an event type')
    .addStringOption(option =>
      option
        .setName('event')
        .setDescription('Enter an event type or wildcard, like Ranger*')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addBooleanOption(option =>
      option
        .setName('as-host')
        .setDescription('Show top hosts instead of attendees')
    )
    .addStringOption(option =>
      option
        .setName('before-date')
        .setDescription('Enter the latest event date in DD/MM/YYYY format')
    )
    .addStringOption(option =>
      option
        .setName('after-date')
        .setDescription('Enter the earliest event date in DD/MM/YYYY format')
    )
    .addStringOption(option =>
      option
        .setName('during')
        .setDescription('Enter one date or a date range in DD/MM/YYYY format')
    )
    .addBooleanOption(option =>
      option
        .setName('all-time')
        .setDescription('Use all-time event data')
    )
    .addIntegerOption(option =>
      option
        .setName('count')
        .setDescription('Enter how many users to show')
        .setMinValue(1)
        .setMaxValue(15)
    ),

  /**
   * @param {import('discord.js').AutocompleteInteraction} interaction
   */
  async autocomplete(interaction) {
    const { name } = interaction.options.getFocused(true)
    if (name !== 'event') {
      await interaction.respond([])
      return
    }
    await respondWithEventTypeAutocomplete(interaction)
  },

  /**
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
      const duringStr = interaction.options.getString('during')

      // Validate and prepare event matcher
      if (!isValidPrefixPattern(input)) {
        await interaction.editReply({ content: 'Invalid event pattern. Use a name or a single trailing * like `Ranger*`.' })
        return
      }
      const rx = toRegex(input)

      const dateFilters = resolveEventDateFilters({
        requestedAllTime: allTimeMode,
        afterInput: afterDateStr,
        beforeInput: beforeDateStr,
        duringInput: duringStr
      })
      if (dateFilters.error) {
        await interaction.editReply({ content: dateFilters.error })
        return
      }

      // Get users to consider based on scope
      const robloxIds = dateFilters.useAllTime
        ? (await database.getAllUsers().catch(() => [])).map(u => u.robloxId).filter(Boolean)
        : await database.getUsersWithWeeklyEvents().catch(() => [])

      if (!robloxIds || robloxIds.length === 0) {
        await interaction.editReply('No users found to evaluate.')
        return
      }

      // Get per-user event id lists
      const userEvents = dateFilters.useAllTime
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
      const eventsById = new Map(eventsArr.map(ev => [ev.eventId || ev.id || ev._id, ev]))

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
          if (!eventMatchesDateRange(ev, dateFilters.afterMs, dateFilters.beforeMs)) continue

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

      const dateLabel = dateFilters.dateLabel ? ` - ${dateFilters.dateLabel}` : ''
      const title = `Top ${dateFilters.useAllTime ? 'All Time' : 'Weekly'} ${topUsers.length} ${hostMode ? 'Hosts' : 'Attendees'} for \`${input}\`${dateLabel}`

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
