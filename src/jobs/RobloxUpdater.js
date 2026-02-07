const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getRobloxIdByDiscord } = require('../api/database.js');
const { getUsernameFromId } = require('noblox.js');
const Logger = require('../api/logger.js');
const config = require('../../config.json');
const { TOKEN: BOT_TOKEN } = config.DISCORD.BOT;
const path = require("path");
const fs = require("fs");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [
        Partials.Message,
        Partials.GuildMember,
        Partials.User
    ]
});

/**
 * Main loop to fetch and cache username/id mappings for all guild members
 */
const RequestLoop = async function () {
    const logger = new Logger('RobloxUpdater', 'UPDATER');
    try {
        const guild = client.guilds.cache.get(config.DISCORD.BOT.GUILD_ID);
        if (!guild) {
            logger.error('Guild not found in cache.');
            return;
        }

        await guild.members.fetch();

        const usernamesArr = [];
        const useridsArr = [];

        for (const [discordId, member] of guild.members.cache) {
            const rid = Number(await getRobloxIdByDiscord(discordId));
            if (!rid) continue;

            let username;
            try {
                await new Promise(resolve => setTimeout(resolve, 2000));
                username = await getUsernameFromId(rid);
            } catch (err) {
                logger.warn(`Could not resolve username for RobloxID ${rid}:`, err.message);
                continue;
            }

            usernamesArr.push(username);
            useridsArr.push(rid);

            logger.debug(`Resolved ${username} (${rid}) for Discord ID ${discordId}`);
        }

        fs.writeFileSync(
            path.join(__dirname, '..', 'cache', 'usernames.json'),
            JSON.stringify(usernamesArr, null, 2)
        );

        fs.writeFileSync(
            path.join(__dirname, '..', 'cache', 'userIds.json'),
            JSON.stringify(useridsArr, null, 2)
        );

        logger.debug('Cache files updated.');
    } catch (err) {
        logger.error('Failed to update cache:', err);
    }
}

client.on('clientReady', () => {
    RequestLoop();
    setInterval(RequestLoop, 10 * 60 * 1000);
});


client.login(BOT_TOKEN);
