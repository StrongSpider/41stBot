const fileRouter = require('express').Router();
const axios = require('axios').default;
const qs = require('querystring');

const { BOT_CLIENT_ID, DISCORD_AUTH_CLIENT_SECRET, BOT_GUILD_ID, DEVELOPER_DISCORD_USER_ID, DISCORD_HICOM_ROLE_ID, DISCORD_OFFICER_ROLE_ID } = require('../../../../../config.json');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { BOT_TOKEN } = require('../../../../../config.json');

fileRouter.post('/api/auth/activity', async function (req, res) {
    const { code } = req.body;

    if (!code) return res.status(400).json({ error: 'No code provided' });

    try {
        const tokenResp = await axios.post(
            'https://discord.com/api/oauth2/token',
            qs.stringify({
                client_id: BOT_CLIENT_ID,
                client_secret: DISCORD_AUTH_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                // No redirect_uri needed for embedded app flow usually, or it depends on config
                // For embedded apps, sometimes redirect_uri is fixed or not sent if using prompt=none logic, 
                // but standard oauth flow from sdk returns a code that expects standard exchange.
                // NOTE: The SDK docs say the code is exchangeable via standard endpoint. 
                // If it fails, we might need a dummy redirect_uri configured in dev portal.
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const accessToken = tokenResp.data.access_token;
        const userResp = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // Reuse role checking logic
        // This could be refactored into a shared util, but duplicating for safety now to avoid breaking existing files.
        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
            partials: [Partials.GuildMember]
        });

        await client.login(BOT_TOKEN);

        let isHICOM = false;
        let isOfficer = false;
        try {
            const guild = await client.guilds.fetch(BOT_GUILD_ID);
            const member = await guild.members.fetch(userResp.data.id);
            if (member) {
                if (member.roles.cache.has(DISCORD_HICOM_ROLE_ID) || member.id === DEVELOPER_DISCORD_USER_ID) {
                    isHICOM = true;
                }
                if (member.roles.cache.has(DISCORD_OFFICER_ROLE_ID) || isHICOM) {
                    isOfficer = true;
                }
            }
        } catch (e) {
            console.error('Failed to fetch guild member for roles', e);
        } finally {
            client.destroy();
        }

        req.session.user = {
            id: userResp.data.id,
            username: `${userResp.data.username}#${userResp.data.discriminator}`,
            avatar: userResp.data.avatar,
            isHICOM,
            isOfficer,
            lastFetched: Date.now()
        };

        res.json({ success: true, user: req.session.user });

    } catch (err) {
        console.error('Activity Auth error', err.response?.data || err);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

module.exports = fileRouter;
