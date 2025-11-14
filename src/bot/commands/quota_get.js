'use strict'

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js')
const { EMBED_COLOR } = require('../../../config.json')
const quota = require('../../api/quota.js')
const database = require('../../api/database.js')
const roblox = require('../../api/roblox.js')

/**
 * Remove IN tag and spaces from a display name for cleaner quota checks
 * @param {string} s
 */
function cleanDisplayName(s) {
    return String(s || '')
        .replace(/\[IN\]/g, '')
        .replace(/\s+/g, '')
}

module.exports = {
    permission: 'ALL',
    data: new SlashCommandBuilder()
        .setName('quota-get')
        .setDescription("Check a user's weekly quota")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check (defaults to you)')
        ),
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            const discordUser = interaction.options.getUser('user') || interaction.user
            if (discordUser.bot) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `You cannot check a bot\'s quota!`' })
                return
            }

            // Resolve the guild member from cache or fetch as a fallback
            let member = interaction.guild?.members?.cache?.get(discordUser.id)
            if (!member) {
                try {
                    member = await interaction.guild.members.fetch(discordUser.id)
                } catch { }
            }
            if (!member || member.user.bot) {
                await interaction.editReply({ content: '<:warning:1297618648810393630> `Could not resolve that user in this server.`' })
                return
            }

            // Build a best-effort Roblox username
            let fallbackName = cleanDisplayName(member.nickname || member.displayName || member.user.displayName || member.user.username)
            let name = fallbackName
            try {
                const robloxId = await database.getRobloxIdByDiscord(member.user.id)
                if (robloxId) {
                    const fetchedName = await roblox.getUsernameFromId(robloxId)
                    if (fetchedName) name = fetchedName
                }
            } catch { }

            // Gather role ids
            const roles = member.roles.cache.map(role => role.id)
            if (member.permissions.has(PermissionsBitField.Flags.Administrator)) roles.push('admin')

            const quotaData = { id: discordUser.id, username: name, roles }

            // Main quota check
            const quotaReport = await quota.checkQuota(quotaData)

            if (quotaReport.status === 'EXEMPT') {
                await interaction.editReply({ content: `<:warning:1297618648810393630> \`${quotaReport.username} is exempt from quotas!\`` })
                return
            }

            if (quotaReport.status === 'NOT VERIFIED') {
                await interaction.editReply({ content: `<:warning:1297618648810393630> \`${quotaReport.username} is not verified!\`` })
                return
            }

            // Support either `.met` or alternative flags if your quota module changed names
            const passedAll = Boolean(quotaReport.met ?? quotaReport.metPurgeQuotas ?? quotaReport.passed ?? false)

            const embed = new EmbedBuilder()
                .setFooter({ text: '41ST BOT', iconURL: interaction.guild?.iconURL() ?? undefined })
                .setTitle(`${quotaReport.username}'s Quota`)
                .setColor(EMBED_COLOR)
                .setTimestamp()
                .addFields([{ name: 'Passed All Quotas', value: passedAll ? '✅' : '❌' }])

            if (quotaReport.purge) embed.addFields({ name: 'Purge DEFCON', value: '<:warning:1297618648810393630>' })

            // Per-role breakdown. Guard every optional to avoid runtime errors when data is partial.
            const items = Array.isArray(quotaReport.quotas) ? quotaReport.quotas : []
            for (let i = 0; i < items.length; i++) {
                const q = items[i]
                const roleName = interaction.guild.roles.cache.get(q.roleId)?.name || 'Unknown Role'

                // Build event lines for this quota role
                let events = ''
                const caps = Array.isArray(q.eventCaps) ? q.eventCaps : []
                for (let j = 0; j < caps.length; j++) {
                    const event = caps[j]
                    const need = event.cap ?? event.count ?? 0
                    const has = event.actual ?? 0
                    const alias = String(event.alias || 'Event')
                    events += `${alias}: \`Needs ${need} (has ${has})\`\n`
                }

                embed.addFields({
                    name: roleName + (q.passed ? ' ✅' : ' ❌'),
                    value: `Event points: \`Needs ${q.quotaEP ?? 0} (has ${q.actualEP ?? 0})\`\n` + events,
                    inline: true
                })
            }

            await interaction.editReply({ embeds: [embed] })
        } catch (err) {
            const msg = err instanceof Error && err.message ? err.message : 'Unknown error'
            const safe = 'Failed to get quota. ' + msg
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe }).catch(() => { })
            } else {
                await interaction.reply({ content: safe, flags: MessageFlags.Ephemeral }).catch(() => { })
            }
        }
    }
}