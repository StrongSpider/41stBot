const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const database = require('../../../api/database.js');
const roblox = require('../../../api/roblox.js');

fileRouter.get('/api/all-time', ensureAuth, async function (req, res) {
    try {
        const events = await database.listAllTimeEvents();

        // Collect all unique user IDs
        const userIds = new Set();
        events.forEach(ev => {
            if (ev.host && ev.host !== -1) userIds.add(ev.host);
            if (ev.supervisor && ev.supervisor !== -1) userIds.add(ev.supervisor);
        });

        // Fetch usernames
        const userMap = {};
        await Promise.all(Array.from(userIds).map(async (id) => {
            try {
                userMap[id] = await roblox.getUsernameFromId(id);
            } catch (e) {
                userMap[id] = 'Unknown';
            }
        }));

        // Attach usernames to events
        const resolvedEvents = events.map(ev => ({
            ...ev,
            host: ev.host === -1 ? 'No User' : (userMap[ev.host] || 'Unknown'),
            supervisor: ev.supervisor === -1 ? 'No User' : (userMap[ev.supervisor] || 'Unknown')
        }));

        res.json(resolvedEvents);
    } catch (err) {
        console.error('GET /api/all-time error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = fileRouter;