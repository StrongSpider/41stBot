const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');
const webhook = require('../../../api/webhook.js');

fileRouter.delete('/api/all-time/:id', ensureAuth, async function (req, res) {
    const { id } = req.params;
    const discordUserId = req.session.user?.id || 'unknown';

    try {
        await database.deleteAllTimeEventById(id);

        // Audit log (optional but good practice)
        await webhook.sendEventDeleteWebhook({ eventId: id, changedBy: discordUserId });

        res.json({ success: true });
    } catch (err) {
        console.error(`DELETE /api/all-time/${id} error`, err);
        res.status(500).json({ error: 'Deletion failed' });
    }
});

module.exports = fileRouter;