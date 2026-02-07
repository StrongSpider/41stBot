'use strict'

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { EMBED_COLOR } = config.GENERAL
const { INACTIVITY_MANAGEMENT: INACTIVITY_MANAGEMENT_ROLE_ID } = config.DISCORD.ROLES
const { DEVELOPER_USER_ID: DEVELOPER_DISCORD_USER_ID } = config.DISCORD.BOT;
const database = require('../../api/database.js')

/**
 * Convert a ms timestamp to a Discord date tag
 * @param {number|Date|string} v
 * @returns {string}
 */
function toDiscordDateTag(v) {
    const ms = v instanceof Date ? v.getTime() : Number(v)
    const unix = Math.floor(ms / 1000)
    return `<t:${unix}:d>`
}

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('inactivity-list')
        .setDescription('List all active inactivity notices'),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        // Either has the management role or is the developer
        if (!interaction.member?.roles?.cache?.has(INACTIVITY_MANAGEMENT_ROLE_ID) && interaction.user.id !== DEVELOPER_DISCORD_USER_ID) {
            return interaction.reply({ content: '<:warning:1297618648810393630> `You do not have permission to use this command!`', flags: MessageFlags.Ephemeral })
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        // Load all active INs from the DB
        const inactivities = await database.getAllInactivities().catch(() => null)

        if (!Array.isArray(inactivities) || inactivities.length === 0) {
            return interaction.editReply({ content: '<:warning:1297618648810393630> `There are no active inactivity notices!`' })
        }

        let currentPage = 0
        const perPage = 9
        const totalPages = Math.ceil(inactivities.length / perPage)

        /**
         * Build a page embed with up to `perPage` entries
         * @param {number} page
         */
        const buildEmbed = async page => {
            const start = page * perPage
            const slice = inactivities.slice(start, start + perPage)

            const embed = new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle('Active Inactivity Notices')

            for (let i = 0; i < slice.length; i++) {
                const inactivity = slice[i]
                const endTag = toDiscordDateTag(inactivity.date)

                // Try cache first, then fetch. If unavailable, show a simple label.
                const member = interaction.guild.members.cache.get(inactivity.discordId) || await interaction.guild.members.fetch(inactivity.discordId).catch(() => null)
                const displayName = member ? member.displayName : 'Unknown User'

                const reason = String(inactivity.reason || 'None provided').slice(0, 512)

                embed.addFields({
                    name: displayName,
                    value:
                        `Ends: ${endTag}\n` +
                        `Reason: \`${reason}\`\n` +
                        `User: <@${inactivity.discordId}>`,
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
                return btn.reply({ content: 'These buttons are not for you.', flags: MessageFlags.Ephemeral })
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
    }
}