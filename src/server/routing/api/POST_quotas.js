const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');

fileRouter.post('/api/quotas', ensureAuth, async function (req, res) {
    return res.status(400).json({error: "Service Offline"})
    const { roleId, quotaEP, overwrites } = req.body;

    // Derive eventCaps from payload (new schema) or fall back to old fields
    let eventCaps = req.body.eventCaps;

    // Support legacy objects with single 'type'
    if (Array.isArray(eventCaps) && eventCaps.length && eventCaps[0].type) {
        eventCaps = eventCaps.map(({ type, count }) => ({ types: [type], count }));
    }

    if (!Array.isArray(eventCaps)) {
        // Legacy support: allowedAll + allowedEvents
        if (req.body.allowedAll) {
            eventCaps = [];
        } else if (Array.isArray(req.body.allowedEvents)) {
            // Each allowed event gets a count of 1
            eventCaps = req.body.allowedEvents.map(type => ({ types: [type], count: 1 }));
        } else {
            eventCaps = [];
        }
    }

    if (!roleId) {
        return res.status(400).json({ error: 'roleId required' });
    }

    // Validate inputs
    if (typeof quotaEP !== 'number' || isNaN(quotaEP) || quotaEP < 0) {
        return res.status(400).json({ error: 'quotaEP must be a non-negative number' });
    }

    if (!Array.isArray(eventCaps)) {
        return res.status(400).json({ error: 'eventCaps must be an array' });
    }

    for (const cap of eventCaps) {
        if (
            !Array.isArray(cap.types) ||
            cap.types.some(t => typeof t !== 'string') ||
            typeof cap.count !== 'number' ||
            cap.count < 1
        ) {
            return res.status(400).json({
                error: 'each eventCaps entry must have a types array of strings and count ≥ 1'
            });
        }
    }

    try {
        await database.setRoleQuota(roleId, quotaEP, eventCaps, overwrites);
        res.json({ success: true });
    } catch (err) {
        console.error('POST /api/quotas error', err);
        res.status(500).json({ error: 'Save failed' });
    }
});

module.exports = fileRouter;