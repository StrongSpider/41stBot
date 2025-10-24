const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');
const roblox = require('../../../api/roblox.js');

const { COMPANY_DISCORD_ROLES, BOT_TOKEN, BOT_GUILD_ID, RANK_DISCORD_ROLES } = require('../../config.json');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const getMembers = require('../util/getMembers.js');

fileRouter.get('/api/users', ensureAuth, async function (req, res) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
        ],
        partials: [
            Partials.GuildMember
        ]
    });

    await client.login(BOT_TOKEN);

    try {
        const robloxIds = await database.getUsersWithWeeklyEvents();
        if (!robloxIds.length) return res.json([]);
        const [pointsList, userEventsList, discordList, membersResp] = await Promise.all([database.getCurrentEventPointsBatch(robloxIds), database.getWeeklyUserEventsBatch(robloxIds), database.getDiscordIdsBatch(robloxIds), getMembers()]);

        const members = membersResp;
        const pointsMap = Object.fromEntries(pointsList.map(o => [o.robloxId, o.eventPoints]));
        const eventsRawMap = Object.fromEntries(userEventsList.map(o => [o.robloxId, o.events]));
        const discordMap = Object.fromEntries(discordList.map(o => [o.robloxId, o.discordId]));
        const allEventIds = [...new Set(userEventsList.flatMap(o => o.events))];
        const weeklyDetails = await database.getWeeklyEventsBatch(allEventIds);
        const weeklyMap = Object.fromEntries(weeklyDetails.map(e => [e.eventid, e]));
        const users = await Promise.all(robloxIds.map(async robloxId => {
            const discordId = discordMap[robloxId];
            const username = robloxId ? await roblox.getUsernameFromId(+robloxId).catch(() => null) : null;
            const eventIds = eventsRawMap[robloxId] || [];
            const events = eventIds
                .map(id => {
                    const e = weeklyMap[id] || {};
                    return { name: e.type, link: e.message };
                })
                .filter(e => e.name && e.link); // Only keep events where both name and link are non-null

            let company = 'Unknown';
            let groupRank = 'Unknown';

            const member = members.find(m => m.id === discordId);

            if (member && Array.isArray(member.roles)) {
                const matchingRole = member.roles.find(r => COMPANY_DISCORD_ROLES[r]);
                if (matchingRole) company = COMPANY_DISCORD_ROLES[matchingRole];

                let highest = 0;
                const guild = client.guilds.cache.get(BOT_GUILD_ID);
                for (let index = 0; index < member.roles.length; index++) {
                    const roleId = member.roles[index];
                    const role = guild.roles.cache.get(roleId)

                    if (role && role.position > highest && RANK_DISCORD_ROLES[roleId]) {
                        highest = role.position;
                        groupRank = RANK_DISCORD_ROLES[roleId];
                    }
                }
            }

            return {
                username,
                groupRank,
                company,
                eventPoints: pointsMap[robloxId] || 0,
                events
            };
        }));
        res.json(users);
    } catch (err) {
        console.error('GET /api/users error:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.destroy();
    }
});

module.exports = fileRouter;