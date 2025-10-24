const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');

fileRouter.delete('/api/weekly/:id', ensureAuth, async function (req, res) {
    const { id } = req.params;
    try {
        await database.deleteEventById(id);
        res.json({ success: true });
    } catch (err) {
        console.error(`DELETE /api/weekly/${id} error`, err);
        res.status(500).json({ error: 'Deletion failed' });
    }
});

module.exports = fileRouter;