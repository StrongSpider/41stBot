'use strict'

const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const config = require('../../../config.json')
const { GROUP_ID: ROBLOX_GROUP_ID } = config.ROBLOX
const axios = require('axios')
const database = require('../../api/database')

const DISCORD_MESSAGE_LIMIT = 2000
const SAFE_MESSAGE_LIMIT = 1900

/**
 * Fetch all members for a Roblox group, handling pagination
 * @param {string|number} groupId
 * @returns {Promise<Array<{
 *   user: { userId: number, username: string, displayName: string },
 *   role: { id: number, name: string, rank: number }
 * }>>}
 */
async function fetchGroupMembers(groupId) {
    const baseUrl = `https://groups.roblox.com/v1/groups/${groupId}/users?limit=100`
    const members = []

    let cursor = null

    do {
        const url = cursor ? `${baseUrl}&cursor=${encodeURIComponent(cursor)}` : baseUrl
        const res = await axios.get(url, { timeout: 7000 })

        if (!res.data || !Array.isArray(res.data.data)) {
            break
        }

        members.push(...res.data.data)
        cursor = res.data.nextPageCursor || null
    } while (cursor)

    return members
}

/**
 * Splits lines into Discord-safe message chunks.
 * @param {string[]} lines
 * @param {number} maxLength
 * @returns {string[]}
 */
function chunkLines(lines, maxLength = SAFE_MESSAGE_LIMIT) {
    const chunks = []
    let current = ''

    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line

        if (next.length > maxLength) {
            if (current) {
                chunks.push(current)
                current = line
            } else {
                chunks.push(line.slice(0, maxLength))
                current = line.slice(maxLength)
            }
        } else {
            current = next
        }
    }

    if (current) {
        chunks.push(current)
    }

    return chunks
}

module.exports = {
    permission: 'OFFICER',
    data: new SlashCommandBuilder()
        .setName('scan-group')
        .setDescription('Scans Roblox group for members not verified in the Discord'),

    /**
     * @param {import('discord.js').CommandInteraction} interaction
     */
    async execute(interaction) {
        try {
            await interaction.deferReply()

            if (!ROBLOX_GROUP_ID) {
                await interaction.editReply('ROBLOX_GROUP_ID is not set in config.json')
                return
            }

            const members = await fetchGroupMembers(ROBLOX_GROUP_ID)

            const notInDiscord = []

            for (const member of members) {
                const robloxId = member?.user?.userId
                if (!robloxId) continue

                const discordId = await database.getDiscordIdByRoblox(robloxId)
                const discordUser = discordId
                    ? await interaction.guild.members.fetch(discordId).catch(() => null)
                    : null

                if (discordUser == null) {
                    notInDiscord.push(member)
                }
            }

            if (notInDiscord.length === 0) {
                await interaction.editReply('✅ All members of the Roblox group are verified in the Discord...')
                return
            }

            const lines = [
                `## Users in Roblox group not verified in Discord`,
                `Found **${notInDiscord.length}** unverified Roblox group members.`,
                ''
            ]

            for (const member of notInDiscord) {
                lines.push(`- ${member.user.username} (Roblox ID: ${member.user.userId}, Rank: ${member.role.name} - ${member.role.rank})`)
            }

            const chunks = chunkLines(lines)

            await interaction.editReply({ content: chunks[0] })

            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp({ content: chunks[i] })
            }
        } catch (err) {
            const msg = err && err.message ? err.message : 'Unknown error'
            const safe = 'Unable to fetch group members right now. ' + msg

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: safe.slice(0, DISCORD_MESSAGE_LIMIT) }).catch(() => { })
            } else {
                await interaction.reply({
                    content: safe.slice(0, DISCORD_MESSAGE_LIMIT),
                    flags: MessageFlags.Ephemeral
                }).catch(() => { })
            }
        }
    }
}