const express = require('express');
const router = express.Router();
const database = require('../../../api/database.js');
const { performBackgroundCheck } = require('../../../api/backgroundCheck.js');

// Helper to get random user or specific user for labeling
router.get('/api/candidates', async (req, res) => {
    try {
        // AUTH CHECK TO BE ADDED HERE (For now assuming internal/protected)

        const { forceId, officerId } = req.query;
        let robloxId = forceId ? Number(forceId) : null;

        if (!robloxId) {
            // Find a random user from existing records (e.g. from badges or groups)
            // Efficient random selection using database logic
            // If officerId is provided, filter out users they have already labeled
            const randomId = await database.getRandomUser(officerId);
            if (randomId) {
                robloxId = randomId;
            }
        }

        if (!robloxId) {
            return res.status(404).json({ error: 'No candidates found' });
        }

        // Perform fresh background check to show current state
        // This is what the officer sees and what we snapshot
        const checkResult = await performBackgroundCheck(robloxId);

        // Enhance data for UI
        if (checkResult.badgeGraph && checkResult.badgeGraph.buffer) {
            checkResult.badgeGraph.base64 = `data:image/png;base64,${checkResult.badgeGraph.buffer.toString('base64')}`;
            delete checkResult.badgeGraph.buffer; // Remove raw buffer to keep JSON light
        }

        // Check if we have an existing AI prediction (Implementation Pending)
        // const prediction = await aiModel.predict(robloxId);

        res.json({
            candidate: checkResult,
            // prediction: prediction 
        });

    } catch (err) {
        console.error('[Labeling Candidate Error]', err);
        res.status(500).json({ error: 'Failed to fetch candidate' });
    }
});

router.post('/api/labels', async (req, res) => {
    try {
        const { targetRobloxId, officerDiscordId, label } = req.body;

        if (!targetRobloxId || !label) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Use session ID if available, otherwise trust body (if coming from authorized context)
        // or default to UNKNOWN if neither (log warning in real app)
        const effectiveOfficerId = req.session?.user?.id || officerDiscordId || 'UNKNOWN';

        const id = await database.addOfficerLabel(targetRobloxId, effectiveOfficerId, label, {}); // Empty snapshot

        res.json({ success: true, id });
    } catch (err) {
        console.error('[Submit Label Error]', err);
        res.status(500).json({ error: 'Failed to save label' });
    }
});

router.get('/api/labels/stats', async (req, res) => {
    try {
        const labels = await database.getOfficerLabels();

        // Simple aggregation
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
        console.error('[Label Stats Error]', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

module.exports = router;
