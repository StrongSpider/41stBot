const fileRouter = require('express').Router();

const ensureAuth = require('../util/ensureAuth.js');
const webhook = require('../../../api/webhook.js');

fileRouter.post('/api/log-event-change', ensureAuth, async function (req, res) {
    const { eventid, eventId, action, changes, changedBy: bodyChangedBy, timestamp: clientTimestamp } = req.body;
    const changedBy = req.session.user?.id || bodyChangedBy || 'unknown';
    const when = clientTimestamp || new Date().toISOString();

    const logEntry = {
        eventId: eventId || eventid,
        changedBy,      // Discord user ID who made the change
        timestamp: when
    };
    if (action) {
        logEntry.action = action;    // e.g. 'update' or 'delete'
    }
    if (changes) {
        logEntry.changes = changes;
    }

    if (logEntry.changes && logEntry.changes.timestamp) {
        const { from, to } = logEntry.changes.timestamp;
        let fromMs, toMs;
        if (from && typeof from === 'object') {
            const secs = from._seconds ?? from.seconds;
            fromMs = secs ? secs * 1000 : NaN;
        } else {
            fromMs = Date.parse(from);
        }
        // parse 'to' value
        toMs = Date.parse(to);
        // if both represent the same millisecond timestamp, remove the diff
        if (!isNaN(fromMs) && !isNaN(toMs) && fromMs === toMs) {
            delete logEntry.changes.timestamp;
        }
    }

    // If no other fields changed, clear changes
    if (logEntry.changes && Object.keys(logEntry.changes).length === 0) {
        delete logEntry.changes;
    }

    // If timestamp truly changed, convert to Discord-formatted timestamps
    if (logEntry.changes && logEntry.changes.timestamp) {
        const { from, to } = logEntry.changes.timestamp;
        // Parse both values to Date objects
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
        // Use Discord timestamp formatting (full style)
        logEntry.changes.timestamp = {
            from: `<t:${fromSec}:F>`,
            to: `<t:${toSec}:F>`
        };
    }

    console.log('[Event Change Log]', logEntry);
    // Send Discord webhook based on action
    if (logEntry.action === 'create') {
        webhook.sendEventCreateWebhook(logEntry);
    } else if (logEntry.action === 'update') {
        webhook.sendEventUpdateWebhook(logEntry);
    } else if (logEntry.action === 'delete') {
        webhook.sendEventDeleteWebhook(logEntry);
    }

    res.json({ success: true });
});

module.exports = fileRouter;