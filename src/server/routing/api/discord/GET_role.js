const fileRouter = require('express').Router();

const { BOT_TOKEN, BOT_GUILD_ID } = require('../../../../../config.json');
const { Client, GatewayIntentBits } = require('discord.js');

fileRouter.get('/api/discord/role/:id', async function (req, res) {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: 'Role ID is required' });
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
        ],
        partials: []
    });

    await client.login(BOT_TOKEN);
    try {
        const guild = await client.guilds.fetch(guildId);
        const role = guild.roles.cache.get(id);
        if (!role) {
            return res.status(404).json({ error: 'Role not found' });
        }
        res.json({ id: role.id, name: role.name });
    } catch (error) {
        console.error(`GET /api/discord/roles/${id} error`, error);
        res.status(500).send('Error fetching role');
    } finally {
        client.destroy();
    }
});

module.exports = fileRouter;