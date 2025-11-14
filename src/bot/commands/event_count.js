'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const { EMBED_COLOR } = require('../../../config.json')
const database = require('../../api/database')
const roblox = require('../../api/roblox')


// WARNING: Regex hell!!! Sorry, I had no other choice...

/**
 * Validate an event-type pattern
 * Allows letters, numbers, space, dot, underscore, hyphen, and an optional single trailing '*'
 * @param {unknown} str
 * @returns {boolean}
 */
function isValidPrefixPattern(str) {
    if (typeof str !== 'string') return false
    if (str.length === 0 || str.length > 64) return false
    if (!/[\x20-\x7E]+/.test(str)) return false // printable ASCII only
    if (!/^[A-Za-z0-9._\- *]+$/.test(str)) return false // allowed chars
    const starCount = (str.match(/\*/g) || []).length
    if (starCount === 0) return true // exact match
    // allow a single trailing star with at least one char before it
    return starCount === 1 && str.endsWith('*') && str.length > 1
}

/**
 * Convert a validated prefix pattern to a case-insensitive regex
 * @param {string} pattern
 * @returns {RegExp}
 */
function prefixPatternToRegex(pattern) {
    const hasStar = pattern.endsWith('*')
    const rawPrefix = hasStar ? pattern.slice(0, -1) : pattern
    // escape regex metacharacters inside the user provided prefix
    const escaped = rawPrefix.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    return new RegExp('^' + escaped + (hasStar ? '.*' : '') + '$', 'i')
}

/**
 * Parse MM/DD/YYYY to UTC ms. End-of-day if isEndOfDay
 * @param {string|null} input
 * @param {boolean} isEndOfDay
 * @returns {number|null}
 */
function parseBound(input, isEndOfDay) {
    if (!input) return null
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input)
    if (!m) return null
    const mm = Number(m[1])
    const dd = Number(m[2])
    const yyyy = Number(m[3])
    if (mm < 1 || mm > 12) return null
    // Date.UTC with day 0 gives the last day of the previous month
    const dim = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate()
    if (dd < 1 || dd > dim) return null
    const h = isEndOfDay ? 23 : 0
    const min = isEndOfDay ? 59 : 0
    const s = isEndOfDay ? 59 : 0
    const ms = isEndOfDay ? 999 : 0
    return Date.UTC(yyyy, mm - 1, dd, h, min, s, ms)
}

/**
 * Normalize MM/DD/YYYY to zero-padded string for display
 * @param {string} input
 */
function fmtDate(input) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input)
    if (!m) return input
    const mm = m[1].padStart(2, '0')
    const dd = m[2].padStart(2, '0')
    const yyyy = m[3]
    return `${mm}/${dd}/${yyyy}`
}

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('event-count')
        .setDescription('Get the number of events')
        .addBooleanOption(option =>
            option
                .setName('all-time')
                .setDescription('If true, count all-time events')
        )
        .addStringOption(option =>
            option
                .setName('after-date')
                .setDescription('Count events on/after this date (MM/DD/YYYY)')
        )
        .addStringOption(option =>
            option
                .setName('before-date')
                .setDescription('Count events on/before this date (MM/DD/YYYY)')
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to count')
        )
        .addBooleanOption(option =>
            option
                .setName('as-host')
                .setDescription('Show events hosted instead of attended')
        )
        .addStringOption(option =>
            option
                .setName('event-type')
                .setDescription('Filter by event type (exact or prefix with *)')
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            // Options with defaults
            const allTime = interaction.options.getBoolean('all-time') ?? false
            const afterInput = interaction.options.getString('after-date') ?? null
            const beforeInput = interaction.options.getString('before-date') ?? null
            const eventTypeInput = interaction.options.getString('event-type') ?? null
            const userInput = interaction.options.getUser('user') ?? null
            const asHostInput = interaction.options.getBoolean('as-host') ?? false

            // Validate event type pattern
            const typePattern = eventTypeInput ? eventTypeInput.trim() : null
            if (typePattern && !isValidPrefixPattern(typePattern)) {
                await interaction.editReply({ content: 'Invalid event-type. Use exact name or a single trailing * (e.g., Ranger*). Only letters, numbers, space, . _ - are allowed.' })
                return
            }
            const typeRx = typePattern ? prefixPatternToRegex(typePattern) : null

            // Parse dates to UTC bounds. After is start of day, before is end of day
            const afterMs = parseBound(afterInput, false)
            const beforeMs = parseBound(beforeInput, true)
            if ((afterInput && afterMs === null) || (beforeInput && beforeMs === null)) {
                await interaction.editReply({ content: 'Invalid date format. Use MM/DD/YYYY.' })
                return
            }

            // Mapping of a Discord user to a verified robloxId
            let robloxId = null
            if (userInput) {
                robloxId = await database.getRobloxIdByDiscord(userInput.id)
                if (robloxId == null) {
                    await interaction.editReply({ content: 'User requested is not verified.' })
                    return
                }
            }

            // If any filter is present we need the event list to apply filters.
            // Otherwise we can use a simple weekly count which is much cheaper.
            const wantFilters = Boolean(
                allTime || afterMs !== null || beforeMs !== null || typeRx || robloxId !== null || asHostInput
            )

            let count = 0
            try {
                if (!wantFilters) {
                    // Fast path: weekly total from IDs
                    count = (await database.getWeeklyEventIds()).length
                } else {
                    // Slow path: fetch events for the chosen scope then filter in memory
                    const events = allTime
                        ? await database.listAllTimeEvents()
                        : await database.listWeeklyEvents()

                    const filtered = events.filter(ev => {
                        const t = ev.timestamp ? Date.parse(ev.timestamp) : NaN
                        // time window checks
                        if (afterMs !== null && !(t >= afterMs)) return false
                        if (beforeMs !== null && !(t <= beforeMs)) return false
                        // event type exact or prefix
                        if (typeRx) {
                            const et = (ev.type || '').toString()
                            if (!typeRx.test(et)) return false
                        }
                        // user filter: either as host or as attendee
                        if (robloxId !== null) {
                            if (asHostInput) return ev.host == robloxId
                            const arr = Array.isArray(ev.attendees) ? ev.attendees : []
                            return arr.some(rid => String(rid) == String(robloxId))
                        }
                        return true
                    })
                    count = filtered.length
                }
            } catch (err) {
                await interaction.editReply({ content: 'Error while counting events: ' + (err?.message || 'unknown error') })
                return
            }

            const titleBits = []
            if (allTime) titleBits.push('All Time')
            if (afterMs !== null && beforeMs !== null) titleBits.push(`${fmtDate(afterInput)} to ${fmtDate(beforeInput)}`)
            else if (afterMs !== null) titleBits.push(`After ${fmtDate(afterInput)}`)
            else if (beforeMs !== null) titleBits.push(`Before ${fmtDate(beforeInput)}`)
            if (eventTypeInput) titleBits.push(`Type: ${eventTypeInput}`)

            if (robloxId !== null) {
                let tag = ''
                try {
                    // prefer a readable Roblox username when we have the id
                    tag = await roblox.getUsernameFromId(robloxId)
                } catch {
                    // fall back to the raw id wrapped as code if lookup fails
                    tag = '`' + String(robloxId) + '`'
                }
                titleBits.push(`${asHostInput ? 'Hosted' : 'Attended'} by ${tag}`)
            }
            if (!titleBits.length) titleBits.push('This Week')

            const embed = new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle('Event Count - ' + titleBits.join(' - '))
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setDescription(String(count) + ' events')
                .setTimestamp()

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to run event-count. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}