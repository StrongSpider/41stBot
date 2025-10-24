const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');

fileRouter.patch('/api/weekly/:id', ensureAuth, async function (req, res) {
    const { id } = req.params;
    const changes = req.body;
    try {
        await database.updateAllTimeEvent(id, changes);
        res.json({ success: true });
    } catch (err) {
        console.error(`PATCH /api/history/${id} error`, err);
        res.status(500).json({ error: 'Update failed' });
    }
});

module.exports = fileRouter;