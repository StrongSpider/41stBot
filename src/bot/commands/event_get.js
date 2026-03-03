'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const { getUsernameFromId } = require('../../api/roblox.js')
const database = require('../../api/database.js')
const {
    resolveEventReference,
    isEventReferenceError,
    formatEventReferenceError
} = require('../utils/eventReference.js')

/**
 * Resolve a Roblox id to a readable tag
 * Falls back to a code-wrapped id if lookup fails
 * @param {string|number} id
 * @returns {Promise<string>}
 */
async function safeUsername(id) {
    try {
        const name = await getUsernameFromId(id)
        return name || ('`' + String(id) + '`')
    } catch {
        return '`' + String(id) + '`'
    }
}

/**
 * Build an attendees code block, truncating before it exceeds ~1000 chars
 * @param {Array<string|number>} attendees
 * @returns {Promise<string>} newline-prefixed usernames or empty string
 */
async function buildAttendeesBlock(attendees) {
    if (!Array.isArray(attendees) || attendees.length === 0) return ''
    const MAX = 1000
    let text = ''
    let added = 0
    for (let i = 0; i < attendees.length; i++) {
        try {
            const uname = await safeUsername(attendees[i])
            const chunk = '\n' + uname
            if (text.length + chunk.length > MAX) {
                const remaining = attendees.length - i
                text += '\n...' + remaining + ' more'
                break
            }
            text += chunk
            added++
        } catch {
            // skip unresolved usernames silently
        }
    }
    return text
}

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('event-get')
        .setDescription('View details for a 41st event')
        .addStringOption(option =>
            option
                .setName('event-id')
                .setDescription('Event ID or log message link to check')
                .setRequired(true)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const eventReference = await resolveEventReference(interaction.options.getString('event-id', true))
            const eventId = eventReference.eventId

            // Load event. If not found, return a clear message.
            let event = eventReference.event
            if (!event) {
                try {
                    event = await database.getAllTimeEventById(eventId)
                } catch { }
            }
            if (!event) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `The requested event does not exist!`' })
                return
            }

            // Core fields
            const fields = []
            fields.push({ name: 'EVENT TYPE', value: '`' + String(event.type) + '`', inline: true })
            fields.push({ name: 'HOST', value: '`' + String(await safeUsername(event.host)) + '`', inline: true })

            if (event.supervisor !== -1 && event.supervisor != null) {
                fields.push({ name: 'SUPERVISOR', value: '`' + String(await safeUsername(event.supervisor)) + '`', inline: true })
            }

            // Timestamp field using Discord's relative time tag
            const unixTs = Math.floor(new Date(event.timestamp).getTime() / 1000)
            fields.push({ name: 'LOGGED TIME', value: `<t:${unixTs}:f>` })

            // Link to the original message if known
            if (event.message) fields.push({ name: 'MESSAGE', value: `[link](${event.message})` })

            // Attendees block as a code fence, truncated safely
            const attendeesBlock = await buildAttendeesBlock(event.attendees || [])
            if (attendeesBlock.length > 0) {
                fields.push({ name: 'ATTENDEES', value: '```' + attendeesBlock + '```' })
            }

            const embed = new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle('Event `' + eventId + '`')
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .addFields(fields)
                .setTimestamp(new Date(event.timestamp))

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            if (isEventReferenceError(err)) {
                await interaction.editReply({ content: formatEventReferenceError(err) }).catch(() => { })
                return
            }
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get event. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
