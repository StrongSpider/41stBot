'use strict'

const {
    SlashCommandBuilder,
    EmbedBuilder,
    MessageFlags
} = require('discord.js')
const { getRobloxIdByDiscord, getDiscordIdByRoblox } = require('../../api/database')
const { getUsernameFromId, getIdFromUsername } = require('../../api/roblox.js')
const config = require('../../../config.json')

const { EMBED_COLOR } = config.GENERAL

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('verify-check')
        .setDescription('Checks the verification status of a user')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('Select the Discord user to check')
        )
        .addStringOption(opt =>
            opt.setName('username')
                .setDescription('Enter the Roblox username to check')
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            const username = interaction.options.getString('username')
            const member = interaction.options.getMember('member')

            let targetRobloxId = null
            if (!username && !member) {
                targetRobloxId = await getRobloxIdByDiscord(interaction.user.id)
            } else if (username) {
                try {
                    targetRobloxId = await getIdFromUsername(username)
                } catch {
                    return interaction.reply({ content: `<:warning:1297618648810393630> \`Could not find a Roblox user with the username "${username}".\``, flags: MessageFlags.Ephemeral })
                }
            } else if (member) {
                targetRobloxId = await getRobloxIdByDiscord(member.user.id)
            }

            if (!targetRobloxId) {
                return interaction.reply({ content: `<:warning:1297618648810393630> \`No verification found for that user.\``, flags: MessageFlags.Ephemeral })
            }

            const linkedUsername = await getUsernameFromId(targetRobloxId).catch(() => 'Unknown')
            const linkedDiscordId = await getDiscordIdByRoblox(targetRobloxId).catch(() => 'Unknown')

            const verifyEmbed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT AUTHENTICATION', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle('Verification Status')
                .setDescription('This user is connected to the following accounts')
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields(
                    { name: 'Roblox Account', value: `[${linkedUsername}](https://www.roblox.com/users/${targetRobloxId}/profile)`, inline: true },
                    { name: 'Discord Account', value: `<@${linkedDiscordId}>`, inline: true }
                )

            await interaction.reply({
                embeds: [verifyEmbed]
            })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: `<:warning:1297618648810393630> \`${msg}\``,
                    embeds: [],
                    components: []
                }).catch(() => { })
            } else {
                await interaction.reply({
                    content: `<:warning:1297618648810393630> \`${msg}\``,
                    flags: MessageFlags.Ephemeral
                }).catch(() => { })
            }
        }
    }
}
