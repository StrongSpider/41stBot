const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js')
const { BOT_TOKEN, BOT_GUILD_ID } = require('../../../../config.json')

const database = require('../../../api/database.js')
const roblox = require('../../../api/roblox.js')

module.exports = async function getMembers() {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers
        ],
        partials: [
            Partials.GuildMember,
            Partials.User
        ]
    })

    try {
        await client.login(BOT_TOKEN)

        const guild = await client.guilds.fetch(BOT_GUILD_ID)
        if (!guild) return []

        await guild.members.fetch()
        await guild.roles.fetch()

        const roleMap = {}
        guild.roles.cache.forEach(role => {
            roleMap[role.id] = role.members.map(m => m.id)
        })

        const data = []
        for (const member of guild.members.cache.values()) {
            if (member.user.bot) continue

            let fallbackName = member.nickname || member.user.username
            fallbackName = fallbackName.replace(/\[IN\]/g, '').replace(/\s+/g, '')

            let name = fallbackName
            try {
                const robloxId = await database.getRobloxIdByDiscord(member.user.id)
                if (robloxId) {
                    const fetchedName = await roblox.getUsernameFromId(robloxId)
                    if (fetchedName) name = fetchedName
                }
            } catch (e) {
                // ignore lookup failures and keep fallbackName
            }

            const roles = Object.entries(roleMap)
                .filter(([roleId, members]) => members.includes(member.id))
                .map(([roleId]) => roleId)
            if (member.permissions.has(PermissionsBitField.Flags.Administrator)) roles.push('admin')

            data.push({
                id: member.user.id,
                username: name,
                roles
            })
        }

        return data
    } catch (error) {
        console.error('Error fetching members:', error)
        return []
    } finally {
        client.destroy()
    }
}