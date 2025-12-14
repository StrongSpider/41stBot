const fileRouter = require('express').Router();
const { BOT_CLIENT_ID } = require('../../../../../config.json');

fileRouter.get('/api/auth/client-id', function (req, res) {
    res.json({ clientId: BOT_CLIENT_ID });
});

module.exports = fileRouter;
