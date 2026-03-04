'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const database = require('../../api/database')
const roblox = require('../../api/roblox')
const { resolveEventDateFilters, eventMatchesDateRange } = require('../utils/eventDateFilters')
const { respondWithEventTypeAutocomplete } = require('../utils/eventTypeAutocomplete')


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

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('event-count')
        .setDescription('Count matching events')
        .addBooleanOption(option =>
            option
                .setName('all-time')
                .setDescription('Use all-time event data')
        )
        .addStringOption(option =>
            option
                .setName('after-date')
                .setDescription('Enter the earliest event date in MM/DD/YYYY format')
        )
        .addStringOption(option =>
            option
                .setName('before-date')
                .setDescription('Enter the latest event date in MM/DD/YYYY format')
        )
        .addStringOption(option =>
            option
                .setName('during')
                .setDescription('Enter one date or a date range in MM/DD/YYYY format')
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Select the user to count')
        )
        .addBooleanOption(option =>
            option
                .setName('as-host')
                .setDescription('Count hosted events instead of attended events')
        )
        .addStringOption(option =>
            option
                .setName('event')
                .setDescription('Enter an event type or wildcard, like Ranger*')
                .setAutocomplete(true)
        ),
    /**
     * @param {import('discord.js').AutocompleteInteraction} interaction
     */
    async autocomplete(interaction) {
        try {
            const { name } = interaction.options.getFocused(true)
            if (name !== 'event') {
                await interaction.respond([])
                return
            }
            await respondWithEventTypeAutocomplete(interaction)
        } catch {
            await interaction.respond([]).catch(() => { })
        }
    },
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
            const duringInput = interaction.options.getString('during') ?? null
            const eventInput = interaction.options.getString('event') ?? null
            const userInput = interaction.options.getUser('user') ?? null
            const asHostInput = interaction.options.getBoolean('as-host') ?? false

            // Validate event type pattern
            const typePattern = eventInput ? eventInput.trim() : null
            if (typePattern && !isValidPrefixPattern(typePattern)) {
                await interaction.editReply({ content: 'Invalid event. Use exact name or a single trailing * (e.g., Ranger*). Only letters, numbers, space, . _ - are allowed.' })
                return
            }
            const typeRx = typePattern ? prefixPatternToRegex(typePattern) : null

            const dateFilters = resolveEventDateFilters({
                requestedAllTime: allTime,
                afterInput,
                beforeInput,
                duringInput
            })
            if (dateFilters.error) {
                await interaction.editReply({ content: dateFilters.error })
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
                dateFilters.useAllTime || dateFilters.hasDateFilter || typeRx || robloxId !== null || asHostInput
            )

            let count = 0
            try {
                if (!wantFilters) {
                    // Fast path: weekly total from IDs
                    count = (await database.getWeeklyEventIds()).length
                } else {
                    // Slow path: fetch events for the chosen scope then filter in memory
                    const events = dateFilters.useAllTime
                        ? await database.listAllTimeEvents()
                        : await database.listWeeklyEvents()

                    const filtered = events.filter(ev => {
                        if (!eventMatchesDateRange(ev, dateFilters.afterMs, dateFilters.beforeMs)) return false
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
            if (dateFilters.useAllTime) titleBits.push('All Time')
            if (dateFilters.dateLabel) titleBits.push(dateFilters.dateLabel)
            if (eventInput) titleBits.push(`Type: ${eventInput}`)

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
