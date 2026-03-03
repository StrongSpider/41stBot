'use strict'

const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const { INACTIVITY_MANAGEMENT: INACTIVITY_MANAGEMENT_ROLE_ID } = config.DISCORD.ROLES
const { DEVELOPER_USER_ID: DEVELOPER_DISCORD_USER_ID } = config.DISCORD.BOT;
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')
const { hasDeveloperOrAdminOverride } = require('../utils/interactionPermissions.js')

/**
 * Validate a date string in MM/DD/YYYY format
 * Accepts only zero-padded numeric input
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
        .setName('inactivity-edit')
        .setDescription("Edit a user's inactivity notice")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to edit')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('date')
                .setDescription('Return date (MM/DD/YYYY)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for inactivity')
                .setRequired(false)
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            // Either has the management role or has the admin/developer override
            if (!interaction.member?.roles?.cache?.has(INACTIVITY_MANAGEMENT_ROLE_ID) && !hasDeveloperOrAdminOverride(interaction, DEVELOPER_DISCORD_USER_ID)) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `You do not have permission to use this command!`', flags: MessageFlags.Ephemeral })
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            const member = interaction.options.getMember('user')
            if (!member || member.user.bot) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You cannot edit inactivity for that user!`' })
                return
            }

            const inactivityData = await database.getInactivity(member.id)
            if (!inactivityData) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `That user is not on inactivity notice!`' })
                return
            }

            const dateInput = interaction.options.getString('date')
            const reasonInput = interaction.options.getString('reason')

            // Default to existing values when an option is omitted
            let newDate = new Date(inactivityData.date)
            let newReason = typeof reasonInput === 'string' ? reasonInput.trim() : inactivityData.reason
            if (newReason === '') newReason = inactivityData.reason
            newReason = String(newReason || '').slice(0, 512) // for embeds

            if (dateInput) {
                // Validate and parse the new date safely
                if (!isValidMDY(dateInput)) {
                    await interaction.editReply({ content: '<:warning:1297618648810393630> `Invalid date format! Use MM/DD/YYYY.`' })
                    return
                }
                newDate = parseMDYEndOfDayUTC(dateInput)
            }

            // Final date guards
            if (Number.isNaN(newDate.getTime())) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `Invalid date provided!`' })
                return
            }
            if (newDate.getTime() <= Date.now()) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `The date must be in the future!`' })
                return
            }

            // Persist the changes
            await database.setInactivity(member.id, newDate.getTime(), newReason)

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Inactivity Notice Edited')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields([
                    { name: 'User', value: `<@${member.id}>`, inline: true },
                    { name: 'Date of Return', value: `${toDiscordRelative(newDate)}`, inline: true },
                    { name: 'Reason', value: `${newReason || 'None provided'}`, inline: true }
                ])

            await interaction.editReply({ embeds: [embed] })

            // Best-effort DM to the affected user
            try {
                await member.send(`Your inactivity notice was updated. New return date: ${dateInput || 'unchanged'}${newReason ? ` | Reason: ${newReason}` : ''}`)
            } catch { }
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to edit inactivity notice. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}
