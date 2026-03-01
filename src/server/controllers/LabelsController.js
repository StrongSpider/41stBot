const database = require('../../api/database.js');
const { performBackgroundCheck, getAIBackgroundCheck } = require('../../api/backgroundCheck.js');
const { createTrainingSnapshot } = require('../../api/ml/featureExtractor.js');
const Logger = require('../../api/logger.js');

const logger = new Logger('LabelsController', 'SERVER');

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
            logger.error('[Labeling Candidate Error] ' + err);
            res.status(500).json({ error: 'Failed to fetch candidate' });
        }
    },

    submitLabel: async (req, res) => {
        try {
            const { targetRobloxId, officerDiscordId, label, snapshot } = req.body;
            if (!targetRobloxId || !label) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const effectiveOfficerId = req.session?.user?.id || officerDiscordId || 'UNKNOWN';
            let trainingSnapshot = null;

            try {
                if (snapshot) {
                    trainingSnapshot = createTrainingSnapshot(snapshot);
                } else {
                    const bgCheck = await getAIBackgroundCheck(targetRobloxId);
                    if (bgCheck?.success) {
                        trainingSnapshot = createTrainingSnapshot(bgCheck);
                    }
                }
            } catch (snapshotError) {
                logger.warn(`[Submit Label Snapshot Warning] ${snapshotError.message}`);
            }

            const id = await database.addOfficerLabel(targetRobloxId, effectiveOfficerId, label, trainingSnapshot);

            res.json({
                success: true,
                id,
                snapshotSaved: !!trainingSnapshot
            });
        } catch (err) {
            logger.error('[Submit Label Error] ' + err);
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
            logger.error('[Label Stats Error] ' + err);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }
};

module.exports = LabelsController;
