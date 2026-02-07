const axios = require('axios').default;
const qs = require('querystring');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('../../../config.json');
const { TOKEN: BOT_TOKEN, CLIENT_ID: BOT_CLIENT_ID, GUILD_ID: BOT_GUILD_ID, DEVELOPER_USER_ID: DEVELOPER_DISCORD_USER_ID } = config.DISCORD.BOT;
const { CLIENT_SECRET: DISCORD_AUTH_CLIENT_SECRET, REDIRECT_URI: DISCORD_AUTH_REDIRECT_URI } = config.DISCORD.AUTH;
const { HICOM: DISCORD_HICOM_ROLE_ID, OFFICER: DISCORD_OFFICER_ROLE_ID } = config.DISCORD.ROLES;
const Logger = require('../../api/logger.js');

const AuthController = {
    discordLogin: (req, res) => {
        if (process.env.NODE_ENV === 'development') {
            req.session.user = {
                id: 'dev-user-id',
                username: 'Dev User',
                discriminator: '0000',
                avatar: null,
                email: 'dev@example.com'
            };
            return res.redirect('http://localhost:3000/');
        }

        const params = qs.stringify({
            client_id: BOT_CLIENT_ID,
            redirect_uri: DISCORD_AUTH_REDIRECT_URI,
            response_type: 'code',
            scope: 'identify'
        });
        res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
    },

    discordCallback: async (req, res) => {
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

            // Role update logic
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
                new Logger('AuthController', 'SERVER').warn('Callback role fetch error:', e);
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

            res.redirect('/');
        } catch (err) {
            new Logger('AuthController', 'SERVER').error('OAuth callback error: ' + (err.response?.data ? JSON.stringify(err.response.data) : (err.message || err)));
            res.status(500).send('Authentication failed');
        }
    },

    getMe: (req, res) => {
        if (req.session.user) {
            res.json(req.session.user);
        } else {
            res.status(401).json({ error: 'Not authenticated' });
        }
    },

    logout: (req, res) => {
        req.session.destroy(err => {
            if (err) {
                new Logger('AuthController', 'SERVER').error('Logout error: ' + err);
                return res.status(500).json({ error: 'Logout failed' });
            }
            res.clearCookie('connect.sid');
            res.json({ success: true });
        });
    },

    updateActivity: async (req, res) => {
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
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const accessToken = tokenResp.data.access_token;
            const userResp = await axios.get('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            // Role sync logic (simplified duplicate similar to callback)
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
                    if (member.roles.cache.has(DISCORD_HICOM_ROLE_ID) || member.id === DEVELOPER_DISCORD_USER_ID) isHICOM = true;
                    if (member.roles.cache.has(DISCORD_OFFICER_ROLE_ID) || isHICOM) isOfficer = true;
                }
            } catch (e) {
                new Logger('AuthController', 'SERVER').warn('Activity role fetch error:', e);
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

            res.json({ success: true, user: req.session.user, access_token: accessToken });
        } catch (err) {
            new Logger('AuthController', 'SERVER').error('Activity Update Error', err);
            res.status(500).json({ error: 'Authentication failed' });
        }
    },

    getClientId: (req, res) => {
        const { CLIENT_ID: BOT_CLIENT_ID } = require('../../../config.json').DISCORD.BOT;
        res.json({ clientId: BOT_CLIENT_ID });
    }
};

module.exports = AuthController;
