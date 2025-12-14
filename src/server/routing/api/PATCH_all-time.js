const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');
const webhook = require('../../../api/webhook.js');

fileRouter.patch('/api/all-time/:id', ensureAuth, async function (req, res) {
    const { id } = req.params;
    const { type, message } = req.body;
    const discordUserId = req.session.user?.id || 'unknown';

    try {
        await database.updateAllTimeEvent(id, { type, message });

        // Audit log
        await webhook.sendEventUpdateWebhook({ eventId: id, changedBy: discordUserId, changes: { type: { to: type }, message: { to: message } } });

        res.json({ success: true });
    } catch (err) {
        console.error(`PATCH /api/all-time/${id} error`, err);
        res.status(500).json({ error: 'Update failed' });
    }
});

module.exports = fileRouter;