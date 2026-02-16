const database = require('../../api/database.js');
const roblox = require('../../api/roblox.js');
const webhook = require('../../api/webhook.js');
const Logger = require('../../api/logger.js');

const EventsController = {
    getEventTypes: async (req, res) => {
        const types = await database.getEventTypes();
        res.json(types);
    },

    getAllTime: async (req, res) => {
        try {
            const events = await database.listAllTimeEvents();
            const userIds = new Set();
            events.forEach(ev => {
                if (ev.host && ev.host !== -1) userIds.add(ev.host);
                if (ev.supervisor && ev.supervisor !== -1) userIds.add(ev.supervisor);
            });

            const userMap = {};
            await Promise.all(Array.from(userIds).map(async (id) => {
                try {
                    userMap[id] = await roblox.getUsernameFromId(id);
                } catch (e) {
                    userMap[id] = 'Unknown';
                }
            }));

            const resolvedEvents = events.map(ev => ({
                ...ev,
                host: ev.host === -1 ? 'No User' : (userMap[ev.host] || 'Unknown'),
                supervisor: ev.supervisor === -1 ? 'No User' : (userMap[ev.supervisor] || 'Unknown')
            }));

            res.json(resolvedEvents);
        } catch (err) {
            new Logger('EventsController', 'SERVER').error('getAllTime error: ' + err);
            res.status(500).json({ error: 'Server error' });
        }
    },

    getWeekly: async (req, res) => {
        try {
            const events = await database.listWeeklyEvents();
            const userIds = new Set();
            events.forEach(ev => {
                if (ev.host && ev.host !== -1) userIds.add(ev.host);
                if (ev.supervisor && ev.supervisor !== -1) userIds.add(ev.supervisor);
            });

            const userMap = {};
            await Promise.all(Array.from(userIds).map(async (id) => {
                try {
                    userMap[id] = await roblox.getUsernameFromId(id);
                } catch (e) {
                    userMap[id] = 'Unknown';
                }
            }));

            const resolvedEvents = events.map(ev => ({
                ...ev,
                host: ev.host === -1 ? 'No User' : (userMap[ev.host] || 'Unknown'),
                supervisor: ev.supervisor === -1 ? 'No User' : (userMap[ev.supervisor] || 'Unknown')
            }));

            res.json(resolvedEvents);
        } catch (err) {
            new Logger('EventsController', 'SERVER').error('getWeekly error: ' + err);
            res.status(500).json({ error: 'Server error' });
        }
    },

    patchAllTime: async (req, res) => {
        const { id } = req.params;
        const { type, message } = req.body;
        const discordUserId = req.session.user?.id || 'unknown';

        try {
            await database.updateAllTimeEvent(id, { type, message });
            await webhook.sendEventUpdateWebhook({ eventId: id, changedBy: discordUserId, changes: { type: { to: type }, message: { to: message } } });
            res.json({ success: true });
        } catch (err) {
            new Logger('EventsController', 'SERVER').error(`PATCH all-time/${id} error: ` + err);
            res.status(500).json({ error: 'Update failed' });
        }
    },

    patchWeekly: async (req, res) => {
        const { id } = req.params;
        const changes = req.body;
        try {
            await database.updateWeeklyEvent(id, changes);
            res.json({ success: true });
        } catch (err) {
            new Logger('EventsController', 'SERVER').error(`PATCH weekly/${id} error: ` + err);
            res.status(500).json({ error: 'Update failed' });
        }
    },

    deleteAllTime: async (req, res) => {
        const { id } = req.params;
        const discordUserId = req.session.user?.id || 'unknown';
        try {
            await database.deleteAllTimeEventById(id);
            await webhook.sendEventDeleteWebhook({ eventId: id, changedBy: discordUserId });
            res.json({ success: true });
        } catch (err) {
            new Logger('EventsController', 'SERVER').error(`DELETE all-time/${id} error: ` + err);
            res.status(500).json({ error: 'Deletion failed' });
        }
    },

    deleteWeekly: async (req, res) => {
        const { id } = req.params;
        try {
            await database.deleteEventById(id);
            res.json({ success: true });
        } catch (err) {
            new Logger('EventsController', 'SERVER').error(`DELETE weekly/${id} error: ` + err);
            res.status(500).json({ error: 'Deletion failed' });
        }
    },

    logEventChange: async (req, res) => {
        const { eventid, eventId, action, changes, changedBy: bodyChangedBy, timestamp: clientTimestamp } = req.body;
        const changedBy = req.session.user?.id || bodyChangedBy || 'unknown';
        const when = clientTimestamp || new Date().toISOString();

        const logEntry = {
            eventId: eventId || eventid,
            changedBy,
            timestamp: when
        };
        if (action) logEntry.action = action;
        if (changes) logEntry.changes = changes;

        if (logEntry.changes && logEntry.changes.timestamp) {
            const { from, to } = logEntry.changes.timestamp;
            let fromMs, toMs;
            if (from && typeof from === 'object') {
                const secs = from._seconds ?? from.seconds;
                fromMs = secs ? secs * 1000 : NaN;
            } else {
                fromMs = Date.parse(from);
            }
            toMs = Date.parse(to);
            if (!isNaN(fromMs) && !isNaN(toMs) && fromMs === toMs) {
                delete logEntry.changes.timestamp;
            }
        }

        if (logEntry.changes && Object.keys(logEntry.changes).length === 0) {
            delete logEntry.changes;
        }

        if (logEntry.changes && logEntry.changes.timestamp) {
            const { from, to } = logEntry.changes.timestamp;
            const parseDate = val => {
                if (typeof val === 'object') {
                    const secs = val._seconds ?? val.seconds;
                    return new Date(secs * 1000);
                }
                return new Date(val);
            };
            const fromDate = parseDate(from);
            const toDate = parseDate(to);
            const fromSec = Math.floor(fromDate.getTime() / 1000);
            const toSec = Math.floor(toDate.getTime() / 1000);
            logEntry.changes.timestamp = {
                from: `<t:${fromSec}:F>`,
                to: `<t:${toSec}:F>`
            };
        }

        new Logger('EventsController', 'SERVER').info('[Event Change Log] ' + JSON.stringify(logEntry, null, 2));

        if (logEntry.action === 'create') {
            webhook.sendEventCreateWebhook(logEntry);
        } else if (logEntry.action === 'update') {
            webhook.sendEventUpdateWebhook(logEntry);
        } else if (logEntry.action === 'delete') {
            webhook.sendEventDeleteWebhook(logEntry);
        }

        res.json({ success: true });
    }
};

module.exports = EventsController;
