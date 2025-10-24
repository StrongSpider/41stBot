const fileRouter = require('express').Router();
const qs = require('querystring');

const { BOT_CLIENT_ID, DISCORD_AUTH_REDIRECT_URI } = require('../../../../config.json');

fileRouter.get('/auth/discord', function (req, res) {
    const params = qs.stringify({
        client_id: BOT_CLIENT_ID,
        redirect_uri: DISCORD_AUTH_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify'
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

module.exports = fileRouter;