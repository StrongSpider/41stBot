const fileRouter = require('express').Router();
const axios = require('axios').default;
const qs = require('querystring');

const { BOT_TOKEN, BOT_CLIENT_ID, DISCORD_AUTH_CLIENT_SECRET, DISCORD_AUTH_REDIRECT_URI, BOT_GUILD_ID, DEVELOPER_DISCORD_USER_ID, DISCORD_HICOM_ROLE_ID } = require('../../../../../config.json');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

fileRouter.get('/api/auth/callback', async function (req, res) {
    const code = req.query.code;

    if (!code) return res.status(400).send('No code provided');

    try {
        const tokenResp = await axios.post(
            'https://discord.com/api/oauth2/token',
            qs.stringify({
                client_id: BOT_CLIENT_ID,
                client_secret: DISCORD_AUTH_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: DISCORD_AUTH_REDIRECT_URI
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const accessToken = tokenResp.data.access_token;
        const userResp = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

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

        let isHICOM = false;
        try {
            const guild = await client.guilds.fetch(BOT_GUILD_ID);
            const member = await guild.members.fetch(userResp.data.id);
            if (member && (member.roles.cache.has(DISCORD_HICOM_ROLE_ID) || member.id === DEVELOPER_DISCORD_USER_ID)) {
                isHICOM = true;
            }
        } catch {

        } finally {
            client.destroy();
        }

        req.session.user = {
            id: userResp.data.id,
            username: `${userResp.data.username}#${userResp.data.discriminator}`,
            avatar: userResp.data.avatar,
            isHICOM,
            lastFetched: Date.now()
        };

        res.redirect('/');
    } catch (err) {
        console.log(err)
        console.error('OAuth callback error', err.response?.data || err);
        res.status(500).send('Authentication failed');
    }
});

module.exports = fileRouter;