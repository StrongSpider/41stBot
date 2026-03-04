'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const { DEVELOPER_USER_ID: DEVELOPER_DISCORD_USER_ID } = config.DISCORD.BOT
const { getIdFromUsername } = require('noblox.js')
const database = require('../../api/database.js')
const { hasDeveloperOrAdminOverride } = require('../utils/interactionPermissions.js')

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
        .setDescription('Force unlink a Discord user from Roblox')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('Select the Discord user to unlink')
        )
        .addStringOption(opt =>
            opt.setName('username')
                .setDescription('Enter the Roblox username to unlink')
        ),
    /**
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

            // Role hierarchy check with admin/developer override
            if (verifiedMember !== null) {
                const invokerHigherOrDev = interaction.member.roles.highest.position > verifiedMember.roles.highest.position
                    || hasDeveloperOrAdminOverride(interaction, DEVELOPER_DISCORD_USER_ID)
                if (!invokerHigherOrDev) {
                    return interaction.reply({ content: '<:warning:1297618648810393630> `You cannot force unverify someone above you!`', flags: MessageFlags.Ephemeral })
                }
            }

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
