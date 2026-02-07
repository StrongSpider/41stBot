const config = require('../../../config.json');
const { TOKEN: BOT_TOKEN, GUILD_ID: BOT_GUILD_ID } = config.DISCORD.BOT;
const { Client, GatewayIntentBits } = require('discord.js');
const Logger = require('../../api/logger.js');

const DiscordController = {
    getRoles: async (req, res) => {
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
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
            new Logger('DiscordController', 'SERVER').error('Error fetching roles:', error);
            res.status(500).send('Error fetching roles');
        } finally {
            client.destroy();
        }
    },

    getRole: async (req, res) => {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: 'Role ID is required' });

        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
        await client.login(BOT_TOKEN);
        try {
            const guild = await client.guilds.fetch(BOT_GUILD_ID);
            const role = guild.roles.cache.get(id);
            if (!role) return res.status(404).json({ error: 'Role not found' });
            res.json({ id: role.id, name: role.name });
        } catch (error) {
            new Logger('DiscordController', 'SERVER').error(`Error fetching role ${id}:`, error);
            res.status(500).send('Error fetching role');
        } finally {
            client.destroy();
        }
    }
};

module.exports = DiscordController;
