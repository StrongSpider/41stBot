'use strict'

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const { EMBED_COLOR, DEVELOPER_DISCORD_USER_ID } = require('../../../config.json')
const { getIdFromUsername } = require('noblox.js')
const database = require('../../api/database.js')

/**
 * /verify-force command
 *
 * Force link a Discord user to a Roblox account.
 *
 * Behavior
 *  - Only officers may run it, with a developer override in config
 *  - Replies are private by default using MessageFlags.Ephemeral
 *  - Checks for existing links to avoid cross-linking conflicts
 *  - Enforces role hierarchy: you cannot verify someone above your highest role
 *
 * Notes
 *  - All output kept plain ASCII
 *  - Uses best-effort Roblox lookups and database calls wrapped in try/catch
 *
 * @file verify_force.js
 */

/**
 * Resolve the target guild member from the slash option
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function getTargetMember(interaction) {
    const optMember = interaction.options.getMember('member')
    if (optMember) return optMember
    const user = interaction.options.getUser('member')
    if (!user) return null
    try { return await interaction.guild.members.fetch(user.id) } catch { return null }
}

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('verify-force')
        .setDescription('Force link a Discord user to a Roblox account')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('Member to verify')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('username')
                .setDescription("Target's Roblox username")
                .setRequired(true)
        ),
    /**
     * Execute the command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const username = interaction.options.getString('username')
            if (!username) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `No username provided!`', flags: MessageFlags.Ephemeral })
            }

            const member = await getTargetMember(interaction)
            if (!member || member.user.bot) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `Could not resolve that member.`', flags: MessageFlags.Ephemeral })
            }

            // Role hierarchy check with developer override
            const invokerHigherOrDev = interaction.member.roles.highest.position > member.roles.highest.position || interaction.user.id === DEVELOPER_DISCORD_USER_ID
            if (!invokerHigherOrDev) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `You cannot force verify someone above you!`', flags: MessageFlags.Ephemeral })
            }

            // Resolve Roblox user id
            let userid
            try { userid = await getIdFromUsername(username) } catch { }
            if (!userid) {
                return interaction.reply({ content: '<:warning:1297618648810393630> `User not found on Roblox.`', flags: MessageFlags.Ephemeral })
            }

            // Private processing from here on
            await interaction.deferReply({ flags: MessageFlags.Ephemeral })

            // Conflict checks
            let existingForDiscord = null
            let existingForRoblox = null
            try { existingForDiscord = await database.getRobloxIdByDiscord(member.user.id) } catch { }
            try { existingForRoblox = await database.getDiscordIdByRoblox(userid) } catch { }

            if (existingForRoblox && existingForRoblox !== member.user.id) {
                return interaction.editReply({ content: '<:warning:1297618648810393630> `That Roblox account is already linked to another Discord user.`' })
            }

            // Upsert the mapping
            await database.upsertRobloxId(member.user.id, userid)

            const action = existingForDiscord && existingForDiscord !== userid ? 'Updated link' : 'Linked'

            const verifyEmbed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT AUTHENTICATION', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Account Verified')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields(
                    { name: 'Action', value: action, inline: true },
                    { name: 'Username', value: `[${username}](https://www.roblox.com/users/${userid}/profile)`, inline: true },
                    { name: 'User ID', value: String(userid), inline: true },
                    { name: 'Discord User', value: `<@${member.user.id}>` }
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