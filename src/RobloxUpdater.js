const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getRobloxIdByDiscord } = require('./api/database.js');
const { getUsernameFromId } = require('noblox.js');
const { BOT_TOKEN } = require('../config.json');
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

const RequestLoop = async function () {
    try {
        const guild = client.guilds.cache.get('691709718304915487');
        if (!guild) {
            console.error('⚠️  Guild not found in cache.');
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
                console.warn(`Could not resolve username for RobloxID ${rid}:`, err.message);
                continue;
            }

            usernamesArr.push(username);
            useridsArr.push(rid);

            console.log(`✅  Resolved ${username} (${rid}) for Discord ID ${discordId}`);
        }

        fs.writeFileSync(
            path.join(__dirname, '.', 'cache', 'usernames.json'),
            JSON.stringify(usernamesArr, null, 2)
        );

        fs.writeFileSync(
            path.join(__dirname, '.', 'cache', 'userIds.json'),
            JSON.stringify(useridsArr, null, 2)
        );

        console.log('✅  Cache files updated.');
    } catch (err) {
        console.error('❌  Failed to update cache:', err);
    }
}

client.on('ready', () => {
    RequestLoop();
    setInterval(RequestLoop, 10 * 60 * 1000);
});


client.login(BOT_TOKEN);