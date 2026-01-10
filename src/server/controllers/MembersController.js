const database = require('../../api/database.js');
const roblox = require('../../api/roblox.js');
const Logger = require('../../api/logger.js');
const getMembers = require('../services/getMembers.js');

const { COMPANY_DISCORD_ROLES, BOT_TOKEN, BOT_GUILD_ID, RANK_DISCORD_ROLES } = require('../../../config.json');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const MembersController = {
    getAll: async (req, res) => {
        try {
            const members = await getMembers();
            res.status(200).json(members);
        } catch (error) {
            new Logger('MembersController', 'SERVER').error('Error fetching members:', error);
            res.status(500).send('Error fetching members');
        }
    },

    getOne: async (req, res) => {
        try {
            const members = await getMembers();
            const memberIndex = members.findIndex(member => {
                return member.username == req.params.id;
            });

            const target = req.params.id;

            const member = members.find(m => m.username === target || m.id === target);

            if (!member) {
                return res.status(404).json({ error: 'Member not found' });
            }
            res.status(200).json(member);
        } catch (error) {
            new Logger('MembersController', 'SERVER').error('Error fetching member:', error);
            res.status(500).send('Error fetching member');
        }
    },

    getUsernames: async (req, res) => {
        try {
            const ids = req.query.ids ? req.query.ids.split(',').map(Number).filter(id => !isNaN(id)) : [];
            if (!ids.length) return res.json({});

            const results = {};
            for (const id of ids) {
                results[id] = await roblox.getUsernameFromId(id);
            }
            res.json(results);
        } catch (e) {
            new Logger('MembersController', 'SERVER').error('Usernames fetch error:', e);
            res.status(500).json({});
        }
    },

    getUsers: async (req, res) => {
        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
            partials: [Partials.GuildMember]
        });

        try {
            await client.login(BOT_TOKEN);
            const robloxIds = await database.getUsersWithWeeklyEvents();
            if (!robloxIds.length) return res.json([]);

            const [pointsList, userEventsList, discordList, membersResp] = await Promise.all([
                database.getCurrentEventPointsBatch(robloxIds),
                database.getWeeklyUserEventsBatch(robloxIds),
                database.getDiscordIdsBatch(robloxIds),
                getMembers()
            ]);

            const members = membersResp;
            const pointsMap = Object.fromEntries(pointsList.map(o => [o.robloxId, o.eventPoints]));
            const eventsRawMap = Object.fromEntries(userEventsList.map(o => [o.robloxId, o.events]));
            const discordMap = Object.fromEntries(discordList.map(o => [o.robloxId, o.discordId]));
            const allEventIds = [...new Set(userEventsList.flatMap(o => o.events))];
            const weeklyDetails = await database.getWeeklyEventsBatch(allEventIds);
            const weeklyMap = Object.fromEntries(weeklyDetails.map(e => [e.eventId, e]));

            const users = await Promise.all(robloxIds.map(async robloxId => {
                const discordId = discordMap[robloxId];
                const username = robloxId ? await roblox.getUsernameFromId(+robloxId).catch(() => null) : null;
                const eventIds = eventsRawMap[robloxId] || [];
                const events = eventIds
                    .map(id => {
                        const e = weeklyMap[id] || {};
                        return { name: e.type, link: e.message };
                    })
                    .filter(e => e.name && e.link);

                let company = 'Unknown';
                let groupRank = 'Unknown';

                const member = members.find(m => m.id === discordId);

                if (member && Array.isArray(member.roles)) {
                    const matchingRole = member.roles.find(r => COMPANY_DISCORD_ROLES[r]);
                    if (matchingRole) company = COMPANY_DISCORD_ROLES[matchingRole];

                    let highest = 0;
                    const guild = client.guilds.cache.get(BOT_GUILD_ID);
                    if (guild) {
                        for (let index = 0; index < member.roles.length; index++) {
                            const roleId = member.roles[index];
                            const role = guild.roles.cache.get(roleId)
                            if (role && role.position > highest && RANK_DISCORD_ROLES[roleId]) {
                                highest = role.position;
                                groupRank = RANK_DISCORD_ROLES[roleId];
                            }
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
            new Logger('MembersController', 'SERVER').error('GET /api/users error: ' + (err && err.message ? err.message : err));
            res.status(500).json({ error: 'Internal server error' });
        } finally {
            client.destroy();
        }
    }
};

module.exports = MembersController;
