const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');

fileRouter.get('/api/quotas', ensureAuth, async function (req, res) {
    try {
        const quotas = await database.listRoleQuotas();
        res.json(quotas);
    } catch (err) {
        console.error('GET /api/quotas error', err);
        res.status(500).json({ error: 'Fetch failed' });
    }
});

module.exports = fileRouter;