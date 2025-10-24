const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');

fileRouter.get('/api/history', ensureAuth, async function (req, res) {
    try {
        const events = await database.listAllTimeEvents();
        res.json(events);
    } catch (err) {
        console.error('GET /api/history error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = fileRouter;