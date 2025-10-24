'use strict'

const { EMBED_COLOR, INACTIVITY_MANAGEMENT_ROLE_ID, INACTIVITY_NOTICE_ROLE_ID, EXEMPT_DISCORD_ROLE_ID, DEVELOPER_DISCORD_USER_ID } = require('../../../config.json');
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const database = require('../../api/database.js')

/**
 * /inactivity-remove command
 *
 * Remove a member's inactivity notice (IN), clean up their roles, and optionally
 * add the weekly exempt role based on day-of-week.
 *
 * Behavior
 *  - Private replies using MessageFlags.Ephemeral
 *  - Only users with the Inactivity Management role or the developer override may run it
 *  - If the member had an IN role, we try to remove it. If today is Sunday or Thu-Sat
 *    we add the exempt role. Failures are reported in the embed description but do not
 *    abort the command.
 *
 * @file inactivity_remove.js
 */

/**
 * Determine if a user should receive the exempt role today
 * Returns true on Sunday (0) and Thursday-Saturday (4-6)
 * @param {Date} [d]
 */
function isQuotaExemptToday(d = new Date()) {
    const day = d.getDay()
    return day === 0 || day >= 4
}

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('inactivity-remove')
        .setDescription("Remove a user's inactivity notice")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to remove')
                .setRequired(true)
        ),
    /**
     * Execute the command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            // Permission gate: Inactivity Managers or developer override only
            if (!interaction.member?.roles?.cache?.has(INACTIVITY_MANAGEMENT_ROLE_ID) && interaction.user.id !== DEVELOPER_DISCORD_USER_ID) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `You do not have permission to use this command!`', flags: MessageFlags.Ephemeral })
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            const member = interaction.options.getMember('user')
            if (!member || member.user.bot) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You cannot modify inactivity for that user!`' })
                return
            }

            // Verify the user is currently on IN
            const inactivityData = await database.getInactivity(member.id).catch(() => null)
            if (!inactivityData) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `That user is not on inactivity notice!`' })
                return
            }

            // Remove IN record first
            await database.deleteInactivity(member.id)

            // Try to adjust roles, but do not hard fail on errors
            let failedRemoveIN = false
            try {
                if (member.roles.cache.has(INACTIVITY_NOTICE_ROLE_ID)) {
                    await member.roles.remove(INACTIVITY_NOTICE_ROLE_ID, 'Inactivity Notice Ended')
                }
            } catch {
                failedRemoveIN = true
            }

            let failedExempt = false
            const giveExempt = isQuotaExemptToday()
            if (giveExempt) {
                try {
                    await member.roles.add(EXEMPT_DISCORD_ROLE_ID, 'Inactivity Notice Ended')
                } catch {
                    failedExempt = true
                }
            }

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Inactivity Notice Removed')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields([
                    { name: 'User', value: `<@${member.id}>`, inline: true },
                    { name: 'Executor', value: `<@${interaction.user.id}>`, inline: true }
                ])

            if (failedRemoveIN || failedExempt) {
                const bits = []
                if (failedRemoveIN) bits.push('remove the inactivity notice role')
                if (failedExempt) bits.push('add the exempt role')
                embed.setDescription(`Failed to ${bits.join(' and ')} for <@${member.id}>. Please adjust roles manually.`)
            }

            await interaction.editReply({ embeds: [embed] })

            // Best-effort DM to the user
            try {
                await member.send(`Your inactivity notice has been removed. You are now ${giveExempt ? 'exempt from quotas this week' : 'expected to complete your quota this week'}.`)
            } catch { }
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to remove inactivity notice. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}