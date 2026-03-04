'use strict'

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const { getUsernameFromId } = require('../../api/roblox.js')
const database = require('../../api/database.js')
const { resolveEventDateFilters, eventMatchesDateRange } = require('../utils/eventDateFilters.js')
const { respondWithEventTypeAutocomplete } = require('../utils/eventTypeAutocomplete.js')

/**
 * Validate an event pattern allowing a single trailing * for prefix matches
 * @param {unknown} str
 * @returns {boolean}
 */
function isValidPrefixPattern(str) {
    if (typeof str !== 'string') return false
    if (str === '*') return true // match any
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
        .setName('event-list')
        .setDescription("List a user's events")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Select the user to review, or leave blank for yourself')
        )
        .addBooleanOption(option =>
            option
                .setName('as-host')
                .setDescription('Show hosted events instead of attended events')
        )
        .addStringOption(option =>
            option
                .setName('event')
                .setDescription('Enter an event type or wildcard, like Ranger*')
                .setAutocomplete(true)
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
            // best effort autocomplete
            await interaction.respond([]).catch(() => { })
        }
    },

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const discordUser = interaction.options.getUser('user') || interaction.user
            const hostMode = interaction.options.getBoolean('as-host') || false
            const afterInput = interaction.options.getString('after-date') ?? null
            const beforeInput = interaction.options.getString('before-date') ?? null
            const duringInput = interaction.options.getString('during') ?? null

            const robloxId = await database.getRobloxIdByDiscord(discordUser.id).catch(() => null)
            if (robloxId == null) {
                await interaction.editReply({
                    content: '<:warning:1297618648810393630> `The requested user does not have a verified Roblox account!`'
                })
                return
            }

            const dateFilters = resolveEventDateFilters({
                afterInput,
                beforeInput,
                duringInput
            })
            if (dateFilters.error) {
                await interaction.editReply({ content: dateFilters.error })
                return
            }

            const eventIds = dateFilters.useAllTime
                ? await database.getAllTimeEventIdsForUser(robloxId).catch(() => [])
                : await database.getWeeklyEventIdsForUser(robloxId).catch(() => [])
            if (!Array.isArray(eventIds) || eventIds.length === 0) {
                await interaction.editReply({ content: dateFilters.useAllTime ? 'User has no matching all-time events.' : 'User has no events this week.' })
                return
            }

            const fetched = await Promise.all(
                eventIds.map(id => (
                    dateFilters.useAllTime
                        ? database.getAllTimeEventById(id).catch(() => null)
                        : database.getWeeklyEvent(id).catch(() => null)
                ))
            )
            const events = fetched.filter(Boolean)

            // Validate the event filter pattern and build a regex if needed
            const input = interaction.options.getString('event') || '*'
            if (!isValidPrefixPattern(input)) {
                await interaction.editReply({ content: 'Invalid event pattern. Use a name or a single trailing * like `Ranger*`.' })
                return
            }
            const rx = toRegex(input)

            // Apply filters
            const patternEvents = rx ? events.filter(ev => rx.test(String(ev.type || ''))) : events
            const datedEvents = patternEvents.filter(ev => eventMatchesDateRange(ev, dateFilters.afterMs, dateFilters.beforeMs))
            const displayEvents = hostMode ? datedEvents.filter(ev => ev.host == robloxId) : datedEvents

            // Sort newest to oldest by timestamp
            displayEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            if (displayEvents.length === 0) {
                const bits = []
                if (input && input !== '*') bits.push(`type \`${input}\``)
                if (dateFilters.dateLabel) bits.push(dateFilters.dateLabel.toLowerCase())
                await interaction.editReply({ content: bits.length ? `No events found for ${bits.join(' and ')}.` : 'No events found.' })
                return
            }

            // Cache Roblox username lookups to avoid repeated requests
            const nameCache = new Map()
            async function usernameOf(id) {
                if (nameCache.has(id)) return nameCache.get(id)
                try {
                    const n = await getUsernameFromId(id)
                    const v = n || '`' + String(id) + '`'
                    nameCache.set(id, v)
                    return v
                } catch {
                    const v = '`' + String(id) + '`'
                    nameCache.set(id, v)
                    return v
                }
            }

            const robloxUsername = await usernameOf(robloxId)

            let currentPage = 0
            const perPage = 9
            const totalPages = Math.ceil(displayEvents.length / perPage)

            /**
             * Build a page embed
             * @param {number} page
             */
            const buildEmbed = async page => {
                const start = page * perPage
                const slice = displayEvents.slice(start, start + perPage)

                const embed = new EmbedBuilder()
                    .setColor(EMBED_COLOR)
                    .setTitle(
                        `${robloxUsername}'s ${dateFilters.useAllTime ? 'All-Time ' : ''}Events` +
                        `${input && input !== '*' ? ` matching \`${input}\`` : ''}` +
                        `${dateFilters.dateLabel ? ` - ${dateFilters.dateLabel}` : ''}` +
                        ` (${start + 1}-${Math.min(start + perPage, displayEvents.length)} of ${displayEvents.length})`
                    )

                for (let index = 0; index < slice.length; index++) {
                    const ev = slice[index]
                    const unixTs = Math.floor(new Date(ev.timestamp).getTime() / 1000)

                    const hostName = await usernameOf(ev.host)
                    let supervisorLine = ''
                    if (ev.supervisor !== -1 && ev.supervisor != null) {
                        const supName = await usernameOf(ev.supervisor)
                        supervisorLine = `Supervisor: \`${supName}\`\n`
                    }

                    const msgLine = ev.message ? `Message: [link](${ev.message})\n` : ''

                    embed.addFields({
                        name: ev.type || 'Event',
                        value:
                            `Host: \`${hostName}\`\n` +
                            supervisorLine +
                            `Logged: <t:${unixTs}:D>\n` +
                            msgLine +
                            `Event ID: \`${ev.eventId || ev.id}\`\n`,
                        inline: true
                    })
                }

                return embed
            }

            /**
             * Build the pagination row
             * @param {number} page
             * @param {boolean} forceDisabled
             */
            const makeRow = (page, forceDisabled = false) =>
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev')
                        .setLabel('Prev')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(forceDisabled || page === 0),
                    new ButtonBuilder()
                        .setCustomId('disabled')
                        .setLabel(`Page ${page + 1}/${totalPages}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('next')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(forceDisabled || page + 1 >= totalPages)
                )

            const reply = await interaction.editReply({
                embeds: [await buildEmbed(currentPage)],
                components: [makeRow(currentPage)]
            })

            // Only allow the invoker to use the paginator
            const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 30000
            })

            collector.on('collect', async btn => {
                if (btn.user.id !== interaction.user.id) {
                    return btn.reply({ content: "These buttons aren't for you.", flags: MessageFlags.Ephemeral })
                }

                await btn.deferUpdate();

                if (btn.customId === 'next' && currentPage + 1 < totalPages) currentPage++
                else if (btn.customId === 'prev' && currentPage > 0) currentPage--

                await interaction.editReply({
                    embeds: [await buildEmbed(currentPage)],
                    components: [makeRow(currentPage)]
                })
            })

            collector.on('end', () => {
                reply.edit({ components: [makeRow(currentPage, true)] }).catch(() => { })
            })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to list events. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
