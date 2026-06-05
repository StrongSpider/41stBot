'use strict'

/**
 * @param {import('discord.js').Guild|null|undefined} guild
 * @returns {Promise<void>}
 */
async function warmGuildMemberCache(guild) {
    if (!guild?.members?.fetch) return
    await guild.members.fetch().catch(() => { })
}

/**
 * Filter leaderboard rows to users that currently hold a Discord role.
 * Rows without a linked Discord id are excluded when a role filter is active.
 *
 * @template T
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {T[]} rows
 * @param {import('discord.js').Role|null|undefined} role
 * @param {(row: T) => string|null|undefined} getDiscordId
 * @returns {Promise<T[]>}
 */
async function filterRowsByRole(interaction, rows, role, getDiscordId) {
    if (!role) return rows

    const guild = interaction.guild
    if (!guild) return []

    await warmGuildMemberCache(guild)

    const filtered = []
    for (const row of rows) {
        const discordId = getDiscordId(row)
        if (!discordId) continue

        let member = guild.members?.cache?.get(String(discordId))
        if (!member && guild.members?.fetch) {
            member = await guild.members.fetch(String(discordId)).catch(() => null)
        }

        if (member?.roles?.cache?.has(role.id)) filtered.push(row)
    }

    return filtered
}

/**
 * @param {import('discord.js').Role|null|undefined} role
 * @returns {string}
 */
function formatRoleFilterLabel(role) {
    return role ? ` - ${role.name}` : ''
}

module.exports = {
    filterRowsByRole,
    formatRoleFilterLabel
}
