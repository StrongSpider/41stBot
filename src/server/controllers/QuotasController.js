const database = require('../../api/database');
const { checkQuota } = require('../../api/quota.js');
const getMembers = require('../services/getMembers.js');
const Logger = require('../../api/logger.js');

const QuotasController = {
    getAll: async (req, res) => {
        try {
            const quotas = await database.listRoleQuotas();
            res.json(quotas);
        } catch (err) {
            new Logger('QuotasController', 'SERVER').error('getAll error: ' + err);
            res.status(500).json({ error: 'Fetch failed' });
        }
    },

    setQuota: async (req, res) => {
        // Service currently offline
        return res.status(400).json({ error: "Service Offline" });
    },

    checkQuotaBatch: async (req, res) => {
        try {
            const members = await getMembers();
            const reports = await Promise.all(
                members.map(member =>
                    checkQuota(member)
                        .then(r => r)
                        .catch(err => ({ username: member.username, error: err.message }))
                )
            );
            res.json(reports);
        } catch (err) {
            new Logger('QuotasController', 'SERVER').error('Batch quota check error: ' + err);
            res.status(500).json({ error: 'Batch quota check failed' });
        }
    },

    deleteQuota: async (req, res) => {
        const { roleId } = req.params;
        try {
            await database.deleteRoleQuota(roleId);
            res.json({ success: true });
        } catch (err) {
            new Logger('QuotasController', 'SERVER').error(`deleteQuota ${roleId} error: ` + err);
            res.status(500).json({ error: 'Deletion failed' });
        }
    }
};

module.exports = QuotasController;
