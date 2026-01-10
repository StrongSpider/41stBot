const database = require('../../api/database.js');
const { performBackgroundCheck } = require('../../api/backgroundCheck.js');
const Logger = require('../../api/logger.js');

const LabelsController = {
    getCandidates: async (req, res) => {
        try {
            const { forceId, officerId } = req.query;
            let robloxId = forceId ? Number(forceId) : null;

            if (!robloxId) {
                const randomId = await database.getRandomUser(officerId);
                if (randomId) robloxId = randomId;
            }

            if (!robloxId) {
                return res.status(404).json({ error: 'No candidates found' });
            }

            const checkResult = await performBackgroundCheck(robloxId);

            if (checkResult.badgeGraph && checkResult.badgeGraph.buffer) {
                checkResult.badgeGraph.base64 = `data:image/png;base64,${checkResult.badgeGraph.buffer.toString('base64')}`;
                delete checkResult.badgeGraph.buffer;
            }

            res.json({
                candidate: checkResult,
                // prediction: ...
            });
        } catch (err) {
            new Logger('LabelsController', 'SERVER').error('[Labeling Candidate Error] ' + err);
            res.status(500).json({ error: 'Failed to fetch candidate' });
        }
    },

    submitLabel: async (req, res) => {
        try {
            const { targetRobloxId, officerDiscordId, label } = req.body;
            if (!targetRobloxId || !label) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const effectiveOfficerId = req.session?.user?.id || officerDiscordId || 'UNKNOWN';
            const id = await database.addOfficerLabel(targetRobloxId, effectiveOfficerId, label, {});

            res.json({ success: true, id });
        } catch (err) {
            new Logger('LabelsController', 'SERVER').error('[Submit Label Error] ' + err);
            res.status(500).json({ error: 'Failed to save label' });
        }
    },

    getStats: async (req, res) => {
        try {
            const labels = await database.getOfficerLabels();
            const counts = {
                REAL: 0,
                LIKELY_REAL: 0,
                LIKELY_ALT: 0,
                ALT: 0,
                TOTAL: labels.length
            };
            labels.forEach(l => {
                if (counts[l.label] !== undefined) counts[l.label]++;
            });
            res.json(counts);
        } catch (err) {
            new Logger('LabelsController', 'SERVER').error('[Label Stats Error] ' + err);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }
};

module.exports = LabelsController;
