const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');

fileRouter.delete('/api/weekly/:roleId', ensureAuth, async function (req, res) {
    const { roleId } = req.params;
    try {
        await database.deleteRoleQuota(roleId);
        res.json({ success: true });
    } catch (err) {
        console.error(`DELETE /api/quotas/${roleId} error`, err);
        res.status(500).json({ error: 'Deletion failed' });
    }
});

module.exports = fileRouter;