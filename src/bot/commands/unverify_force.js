'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const { EMBED_COLOR, DEVELOPER_DISCORD_USER_ID } = require('../../../config.json')
const { getIdFromUsername } = require('noblox.js')
const database = require('../../api/database.js')

/**
 * /unverify-force command
 *
 * Force unlink a Discord user from a Roblox account.
 *
 * Behavior
 *  - Only hicom may run it, with a developer override in config
 *  - Replies are private by default using MessageFlags.Ephemeral
 *  - Checks for existing links to avoid cross-linking conflicts
 *  - Enforces role hierarchy: you cannot verify someone above your highest role
 *
 * Notes
 *  - Uses best-effort Roblox lookups and database calls wrapped in try/catch
 *
 * @file unverify_force.js
 */

// Get guild member object
async function getMember(guild, userid) {
    try { return await guild.members.fetch(userid) } catch { return null }
}

/**
 * Resolve the target guild member from the slash option
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function getTargetMember(interaction) {
    const optMember = interaction.options.getMember('member')
    if (optMember) return optMember
    const user = interaction.options.getUser('member')
    if (!user) return null
    return await getMember(interaction.guild, user.id)
}

module.exports = {
    permission: 'HICOM',
    data: new SlashCommandBuilder()
        .setName('unverify-force')
        .setDescription('Force unlink a Discord user to a Roblox account')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('Target discord mention')
        )
        .addStringOption(opt =>
            opt.setName('username')
                .setDescription("Target's Roblox username")
        ),
    /**
     * Execute the command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const username = interaction.options.getString('username') || null
            const member = await getTargetMember(interaction)

            if (username === null && member === null) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `No user provided!`', flags: MessageFlags.Ephemeral })
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            let verifiedMemberId = null
            if (member === null) {
                // Resolve Roblox user id
                let userid
                try { userid = await getIdFromUsername(username) } catch { }
                if (!userid) {
                    return interaction.reply({ content: '<:warning:1297618648810393630> `User not found on Roblox.`', flags: MessageFlags.Ephemeral })
                }

                verifiedMemberId = await database.getDiscordIdByRoblox(userid)
            } else {
                verifiedMemberId = member.id
            }

            if (verifiedMemberId === null) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `User not found!`', flags: MessageFlags.Ephemeral })
            }

            const verifiedMember = await getMember(interaction.guild, verifiedMemberId)

            // Role hierarchy check with developer override
            if (verifiedMember !== null) {
                const invokerHigherOrDev = interaction.member.roles.highest.position > verifiedMember.roles.highest.position || interaction.user.id === DEVELOPER_DISCORD_USER_ID
                if (!invokerHigherOrDev) {
                    return interaction.reply({ content: '<:warning:1297618648810393630> `You cannot force unverify someone above you!`', flags: MessageFlags.Ephemeral })
                }
            }


            // Upsert the mapping
            await database.deleteDiscordId(verifiedMemberId)

            const action = 'Deleted link'

            const verifyEmbed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT AUTHENTICATION', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Account Unverified')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields(
                    { name: 'Action', value: action, inline: true },
                    { name: 'Discord User', value: `<@${verifiedMemberId}>` }
                )

            await interaction.editReply({ embeds: [verifyEmbed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = '<:warning:1297618648810393630> `' + msg + '`'
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}