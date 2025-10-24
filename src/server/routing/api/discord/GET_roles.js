const fileRouter = require('express').Router();

const { BOT_TOKEN, BOT_GUILD_ID } = require('../../../../../config.json');
const { Client, GatewayIntentBits } = require('discord.js');

fileRouter.get('/api/discord/roles', async function(req, res) {
    const client = new Client({
        intents: [ GatewayIntentBits.Guilds ],
    });
    await client.login(BOT_TOKEN);

    try {
        const guild = await client.guilds.fetch(BOT_GUILD_ID);
        
        const rolesCollection = await guild.roles.fetch();

        const roles = Array.from(rolesCollection.values()).map(r => ({
            id: r.id,
            name: r.name
        }));
        res.json(roles);
    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).send('Error fetching roles');
    } finally {
        client.destroy();
    }
});

module.exports = fileRouter;