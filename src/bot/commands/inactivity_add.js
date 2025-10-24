'use strict'

const { EMBED_COLOR, INACTIVITY_MANAGEMENT_ROLE_ID, INACTIVITY_NOTICE_ROLE_ID, DISCORD_OFFICER_ROLE_ID, DEVELOPER_DISCORD_USER_ID } = require('../../../config.json');
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')

/**
 * /inactivity-add command
 *
 * Put a member on an inactivity notice (IN) until a given return date, with a reason.
 *
 * Behavior
 *  - Only members with the Inactivity Management role or the developer may use it
 *  - Stores the IN in the DB and attempts to add the `INACTIVITY_NOTICE_ROLE_ID`
 *  - DMs the user and, if they are an officer, appends `[IN]` to their nickname
 *  - Replies ephemerally using MessageFlags.Ephemeral
 *
 * @file inactivity_add.js
 */

/**
 * Validate a date string in MM/DD/YYYY format
 * Accepts only zero-padded numeric input to avoid ambiguous parsing
 * @param {unknown} s
 * @returns {boolean}
 */
function isValidMDY(s) {
    if (typeof s !== 'string') return false
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
    if (!m) return false
    const mm = Number(m[1])
    const dd = Number(m[2])
    const yyyy = Number(m[3])
    if (mm < 1 || mm > 12) return false
    // day 0 of next month gives last day of current month
    const dim = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate()
    if (dd < 1 || dd > dim) return false
    return true
}

/**
 * Parse MM/DD/YYYY and return a Date at 23:59:59.999 UTC for that day
 * We use end-of-day so "return by" includes the whole day
 * @param {string} s
 * @returns {Date}
 */
function parseMDYEndOfDayUTC(s) {
    const [mm, dd, yyyy] = s.split('/')
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 23, 59, 59, 999))
}

/**
 * Convert a Date to a Discord relative time tag
 * @param {Date} date
 * @returns {string}
 */
function toDiscordRelative(date) {
    const unix = Math.floor(date.getTime() / 1000)
    return `<t:${unix}:R>`
}

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('inactivity-add')
        .setDescription("Log a user's inactivity notice")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to add')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('date')
                .setDescription('Return date (MM/DD/YYYY)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for inactivity')
                .setRequired(true)
        ),
    /**
     * Execute the command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            // Permission gate: either has the management role or is the developer
            if (!interaction.member?.roles?.cache?.has(INACTIVITY_MANAGEMENT_ROLE_ID) && interaction.user.id !== DEVELOPER_DISCORD_USER_ID) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `You do not have permission to use this command!`', flags: MessageFlags.Ephemeral })
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            const member = interaction.options.getMember('user')
            const dateString = interaction.options.getString('date', true)
            const reasonRaw = interaction.options.getString('reason', true)

            // Basic member checks
            if (!member || member.user.bot) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You cannot put that user on inactivity notice!`' })
                return
            }

            // Date validation and normalization
            if (!isValidMDY(dateString)) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `Invalid date format! Use MM/DD/YYYY.`' })
                return
            }
            const returnDate = parseMDYEndOfDayUTC(dateString)
            if (returnDate.getTime() <= Date.now()) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `The date must be in the future!`' })
                return
            }

            // Reason hygiene. Discord embed field limit is 1024, keep it modest.
            const reasonString = String(reasonRaw).trim().slice(0, 512)

            // Persist to DB first
            await database.setInactivity(member.id, returnDate.getTime(), reasonString)

            // Try to add the notice role. Do not hard fail if this misses.
            let failedRole = false
            try {
                if (!member.roles.cache.has(INACTIVITY_NOTICE_ROLE_ID)) {
                    await member.roles.add(INACTIVITY_NOTICE_ROLE_ID, 'Inactivity Notice')
                }
            } catch (err) {
                failedRole = true
            }

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Inactivity Notice Added')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields([
                    { name: 'User', value: `<@${member.id}>`, inline: true },
                    { name: 'Date of Return', value: `${toDiscordRelative(returnDate)}`, inline: true },
                    { name: 'Reason', value: reasonString || 'None provided', inline: true }
                ])

            if (failedRole) {
                embed.setDescription(`Failed to add the inactivity notice role to <@${member.id}>. The IN was logged. Please add the role manually.`)
            }

            await interaction.editReply({ embeds: [embed] })

            // Best-effort DM to the user
            try {
                await member.send(`You have been put on inactivity notice. Please return by ${dateString}. Reason: ${reasonString || 'None provided'}`)
            } catch { }

            // If the member is an officer, add [IN] to their nickname
            try {
                if (member.roles.cache.has(DISCORD_OFFICER_ROLE_ID)) {
                    const current = member.displayName || member.user.username
                    if (!/\[IN\]$/.test(current)) {
                        await member.setNickname(`${current} [IN]`, 'Inactivity Notice')
                    }
                }
            } catch { }
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to add inactivity notice. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}