'use strict';

const { pool } = require('../connection');
const { ensureTimestamp, toId, toNumOrNull, assertSafeEventType } = require('../utils');
const {
    WEEKLY_EVENTS_TABLE,
    ALL_TIME_EVENTS_TABLE,
    WEEKLY_EVENTS_INDEX_TABLE,
    ALL_TIME_EVENTS_INDEX_TABLE,
    EVENT_POINTS_TABLE,
    ALL_TIME_EVENT_POINTS_TABLE,
    EVENT_TYPES_TABLE,
    EVENT_TYPES_CACHE_TTL_MS
} = require('../constants');

// ===========================================
// Event Types
// ===========================================

let _eventTypesCache = null;
let _eventTypesInFlight = null;

async function _loadEventTypesFromDb() {
    const res = await pool.query(`SELECT type FROM ${EVENT_TYPES_TABLE}`);
    return res.rows.map(r => String(r.type));
}

/**
 * Get all available event types
 * @param {Object} [opts]
 * @param {boolean} [opts.refresh] Force refresh from DB
 * @returns {Promise<string[]>}
 */
async function getEventTypes(opts) {
    const refresh = opts && opts.refresh === true;
    const now = Date.now();
    if (!refresh && _eventTypesCache && _eventTypesCache.expiresAt > now) return _eventTypesCache.data;
    if (!refresh && _eventTypesInFlight) return _eventTypesInFlight;
    _eventTypesInFlight = (async () => {
        const data = await _loadEventTypesFromDb();
        _eventTypesCache = { data, expiresAt: now + EVENT_TYPES_CACHE_TTL_MS };
        _eventTypesInFlight = null;
        return data;
    })();
    return _eventTypesInFlight;
}

/**
 * Add a new event type
 * @param {string} type 
 * @returns {Promise<string>}
 */
async function addEventType(type) {
    const t = String(assertSafeEventType(type));
    await pool.query(
        `INSERT INTO ${EVENT_TYPES_TABLE} (type) VALUES ($1) ON CONFLICT (type) DO NOTHING`,
        [t]
    );
    if (_eventTypesCache) {
        if (!_eventTypesCache.data.includes(t)) _eventTypesCache.data.push(t);
        _eventTypesCache.expiresAt = Date.now() + EVENT_TYPES_CACHE_TTL_MS;
    }
    return t;
}

/**
 * Remove an event type
 * @param {string} type 
 * @returns {Promise<void>}
 */
async function removeEventType(type) {
    const t = String(assertSafeEventType(type));
    await pool.query(`DELETE FROM ${EVENT_TYPES_TABLE} WHERE type = $1`, [t]);
    if (_eventTypesCache) {
        _eventTypesCache.data = _eventTypesCache.data.filter(x => x !== t);
        _eventTypesCache.expiresAt = Date.now() + EVENT_TYPES_CACHE_TTL_MS;
    }
}

function clearEventTypesCache() {
    _eventTypesCache = null;
    _eventTypesInFlight = null;
}

// ===========================================
// Event Helper: Usernames
// ===========================================

async function _idToUsernameSafe(id) {
    const n = Number(id);
    if (!isFinite(n) || n === -1) return '';
    try {
        const { getUsernameFromId } = require('../../roblox');
        const name = await getUsernameFromId(n);
        return name || '';
    } catch {
        return '';
    }
}

async function _eventDataWithUsernames(ev) {
    if (!ev || typeof ev !== 'object') return ev;
    const hostName = await _idToUsernameSafe(ev.host);
    const supervisorName = await _idToUsernameSafe(ev.supervisor);
    const attendeeNames = await Promise.all((Array.isArray(ev.attendees) ? ev.attendees : []).map(_idToUsernameSafe));
    const filtered = attendeeNames.filter(Boolean);
    return {
        ...ev,
        host: hostName || '',
        supervisor: supervisorName || '',
        attendees: filtered
    };
}

// ===========================================
// Event Access
// ===========================================

/**
 * Index an event for a specific user
 * @param {number|string} robloxId 
 * @param {string} eventId 
 * @returns {Promise<void>}
 */
async function indexEventForUser(robloxId, eventId) {
    const rid = toId(robloxId);
    await pool.query(
        `INSERT INTO ${WEEKLY_EVENTS_INDEX_TABLE} (robloxid, events)
     VALUES ($1, ARRAY[$2::uuid])
     ON CONFLICT (robloxid) DO UPDATE
       SET events = array_append(${WEEKLY_EVENTS_INDEX_TABLE}.events, $2::uuid)
     WHERE NOT (${WEEKLY_EVENTS_INDEX_TABLE}.events @> ARRAY[$2::uuid])`,
        [rid, String(eventId)]
    );
    await pool.query(
        `INSERT INTO ${ALL_TIME_EVENTS_INDEX_TABLE} (robloxid, events)
     VALUES ($1, ARRAY[$2::uuid])
     ON CONFLICT (robloxid) DO UPDATE
       SET events = array_append(${ALL_TIME_EVENTS_INDEX_TABLE}.events, $2::uuid)
     WHERE NOT (${ALL_TIME_EVENTS_INDEX_TABLE}.events @> ARRAY[$2::uuid])`,
        [rid, String(eventId)]
    );
}

/**
 * Remove event index for a user
 * @param {number|string} robloxId 
 * @param {string} eventId 
 * @returns {Promise<void>}
 */
async function unindexEventForUser(robloxId, eventId) {
    const rid = toId(robloxId);
    await pool.query(
        `UPDATE ${WEEKLY_EVENTS_INDEX_TABLE} SET events = array_remove(events, $2::uuid) WHERE robloxid = $1`,
        [rid, String(eventId)]
    );
    await pool.query(
        `UPDATE ${ALL_TIME_EVENTS_INDEX_TABLE} SET events = array_remove(events, $2::uuid) WHERE robloxid = $1`,
        [rid, String(eventId)]
    );
}

/**
 * Create a new weekly event (and all-time record)
 * @param {import('../types').Event} data 
 * @returns {Promise<string>} Created Event ID
 */
async function createWeeklyEvent(data) {
    data.attendees = (data.attendees || []).map(e => Number(e));
    data.host = Number(data.host);
    data.supervisor = Number(data.supervisor);
    data.timestamp = ensureTimestamp(data.timestamp);

    const { rows } = await pool.query('SELECT gen_random_uuid() as id');
    const eventId = String(rows[0].id);

    await pool.query(
        `INSERT INTO ${WEEKLY_EVENTS_TABLE} (eventid, attendees, host, supervisor, timestamp, type, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, data.attendees, data.host, data.supervisor, data.timestamp, data.type, data.message]
    );

    await pool.query(
        `INSERT INTO ${ALL_TIME_EVENTS_TABLE} (eventid, attendees, host, supervisor, timestamp, type, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventId, data.attendees, data.host, data.supervisor, data.timestamp, data.type, data.message]
    );

    for (const uid of data.attendees) await indexEventForUser(uid, eventId);
    await indexEventForUser(data.host, eventId);



    return eventId;
}

// ... Additional query functions below ...
// Due to size, I will include key ones. For full refactor I need all of them.

/**
 * Get a weekly event by ID
 * @param {string} eventId 
 * @returns {Promise<import('../types').Event|null>}
 */
async function getWeeklyEvent(eventId) {
    const res = await pool.query(
        `SELECT * FROM ${WEEKLY_EVENTS_TABLE} WHERE eventid = $1`,
        [String(eventId)]
    );
    if (!res.rows[0]) return null;
    const d = res.rows[0];
    return {
        eventId: String(d.eventid),
        attendees: (d.attendees || []).map(e => Number(e)),
        host: Number(d.host),
        supervisor: Number(d.supervisor),
        timestamp: ensureTimestamp(d.timestamp),
        type: d.type,
        message: d.message
    };
}

/**
 * Get an all-time event by ID
 * @param {string} eventId 
 * @returns {Promise<import('../types').Event|null>}
 */
async function getAllTimeEventById(eventId) {
    const res = await pool.query(
        `SELECT * FROM ${ALL_TIME_EVENTS_TABLE} WHERE eventid = $1`,
        [String(eventId)]
    );
    if (!res.rows[0]) return null;
    const d = res.rows[0];
    return {
        eventId: String(d.eventid),
        attendees: (d.attendees || []).map(e => Number(e)),
        host: Number(d.host),
        supervisor: Number(d.supervisor),
        timestamp: ensureTimestamp(d.timestamp),
        type: d.type,
        message: d.message
    };
}

/**
 * Find event by message URL/Link
 * @param {string} messageUrl 
 * @returns {Promise<import('../types').Event|null>}
 */
async function findEventByMessage(messageUrl) {
    const res = await pool.query(
        `SELECT * FROM ${ALL_TIME_EVENTS_TABLE} WHERE message = $1 LIMIT 1`,
        [messageUrl]
    );
    if (!res.rows[0]) return null;
    const d = res.rows[0];
    return {
        eventId: String(d.eventid),
        attendees: (d.attendees || []).map(e => Number(e)),
        host: Number(d.host),
        supervisor: Number(d.supervisor),
        timestamp: ensureTimestamp(d.timestamp),
        type: d.type,
        message: d.message
    };
}

/**
 * Update a weekly event
 * @param {string} eventId 
 * @param {Partial<import('../types').Event>} updates 
 * @returns {Promise<void>}
 */
async function updateWeeklyEvent(eventId, updates) {
    if (updates.attendees !== undefined) updates.attendees = updates.attendees.map(e => Number(e));
    if (updates.host !== undefined) updates.host = Number(updates.host);
    if (updates.supervisor !== undefined) updates.supervisor = Number(updates.supervisor);
    if (updates.timestamp !== undefined) updates.timestamp = ensureTimestamp(updates.timestamp);

    const oldData = await getWeeklyEvent(eventId);
    if (!oldData) throw new Error(`Weekly event ${eventId} not found`);

    const fields = [];
    const values = [];
    let idx = 1;
    for (const key in updates) {
        fields.push(`${key} = $${idx++}`);
        values.push(updates[key]);
    }
    values.push(String(eventId));

    if (fields.length) {
        const setClause = fields.join(', ');
        await pool.query(
            `UPDATE ${WEEKLY_EVENTS_TABLE} SET ${setClause} WHERE eventid = $${idx}`,
            values
        );
        await pool.query(
            `UPDATE ${ALL_TIME_EVENTS_TABLE} SET ${setClause} WHERE eventid = $${idx}`,
            values
        );
    }

    const oldAtt = oldData.attendees || [];
    const newAtt = updates.attendees || oldData.attendees || [];
    for (const uid of oldAtt.filter(x => !newAtt.includes(x))) await unindexEventForUser(uid, eventId);
    for (const uid of newAtt.filter(x => !oldAtt.includes(x))) await indexEventForUser(uid, eventId);
}

async function updateWeeklyEventPartial(eventId, updates) {
    return updateWeeklyEvent(eventId, updates);
}

/**
 * Update an all-time event
 * @param {string} eventId 
 * @param {Partial<import('../types').Event>} updates 
 * @returns {Promise<void>}
 */
async function updateAllTimeEvent(eventId, updates) {
    if (updates.timestamp !== undefined) updates.timestamp = ensureTimestamp(updates.timestamp);
    const fields = [];
    const values = [];
    let idx = 1;
    for (const key in updates) {
        fields.push(`${key} = $${idx++}`);
        values.push(updates[key]);
    }
    values.push(String(eventId));
    if (fields.length) {
        const setClause = fields.join(', ');
        await pool.query(
            `UPDATE ${ALL_TIME_EVENTS_TABLE} SET ${setClause} WHERE eventid = $${idx}`,
            values
        );
        await pool.query(
            `UPDATE ${WEEKLY_EVENTS_TABLE} SET ${setClause} WHERE eventid = $${idx}`,
            values
        );
    }
}

/**
 * Delete a weekly event by ID
 * @param {string} eventId 
 * @returns {Promise<void>}
 */
async function deleteEventById(eventId) {
    const weeklyData = await getWeeklyEvent(eventId);
    if (weeklyData) {
        await pool.query(`DELETE FROM ${WEEKLY_EVENTS_TABLE} WHERE eventid = $1`, [String(eventId)]);
        await pool.query(`DELETE FROM ${ALL_TIME_EVENTS_TABLE} WHERE eventid = $1`, [String(eventId)]);
        const attendees = Array.isArray(weeklyData.attendees) ? [...weeklyData.attendees] : [];
        if (!attendees.includes(weeklyData.host)) attendees.push(weeklyData.host);
        if (!attendees.includes(weeklyData.supervisor)) attendees.push(weeklyData.supervisor);
        for (const uid of attendees) await unindexEventForUser(uid, eventId);
        return;
    }
    const historyData = await getAllTimeEventById(eventId);
    if (historyData) {
        await pool.query(`DELETE FROM ${ALL_TIME_EVENTS_TABLE} WHERE eventid = $1`, [String(eventId)]);
        const attendees = Array.isArray(historyData.attendees) ? historyData.attendees : [];
        for (const uid of attendees) await unindexEventForUser(uid, eventId);
    }
}

/**
 * Delete an all-time event by ID
 * @param {string} eventId 
 * @returns {Promise<void>}
 */
async function deleteAllTimeEventById(eventId) {
    const oldWeekly = await getWeeklyEvent(eventId);
    await pool.query(`DELETE FROM ${ALL_TIME_EVENTS_TABLE} WHERE eventid = $1`, [String(eventId)]);
    await pool.query(`DELETE FROM ${WEEKLY_EVENTS_TABLE} WHERE eventid = $1`, [String(eventId)]);
    const attendees = oldWeekly && Array.isArray(oldWeekly.attendees) ? [...oldWeekly.attendees] : [];
    if (oldWeekly) {
        if (!attendees.includes(oldWeekly.host)) attendees.push(oldWeekly.host);
        if (!attendees.includes(oldWeekly.supervisor)) attendees.push(oldWeekly.supervisor);
    }
    for (const uid of attendees) await unindexEventForUser(uid, eventId);
}

/**
 * List all weekly events
 * @returns {Promise<import('../types').Event[]>}
 */
async function listWeeklyEvents() {
    const res = await pool.query(`SELECT * FROM ${WEEKLY_EVENTS_TABLE}`);
    return res.rows.map(row => ({
        eventId: String(row.eventid),
        attendees: (row.attendees || []).map(e => Number(e)),
        host: Number(row.host),
        supervisor: Number(row.supervisor),
        timestamp: ensureTimestamp(row.timestamp),
        type: row.type,
        message: row.message
    }));
}

/**
 * Get all weekly event IDs
 * @returns {Promise<string[]>}
 */
async function getWeeklyEventIds() {
    const res = await pool.query(`SELECT eventid FROM ${WEEKLY_EVENTS_TABLE}`);
    return res.rows.map(r => String(r.eventid));
}

/**
 * List all all-time events
 * @returns {Promise<import('../types').Event[]>}
 */
async function listAllTimeEvents() {
    const res = await pool.query(`SELECT * FROM ${ALL_TIME_EVENTS_TABLE}`);
    return res.rows.map(row => ({
        eventId: String(row.eventid),
        attendees: (row.attendees || []).map(e => Number(e)),
        host: Number(row.host),
        supervisor: Number(row.supervisor),
        timestamp: ensureTimestamp(row.timestamp),
        type: row.type,
        message: row.message
    }));
}

/**
 * Get weekly event IDs for a user
 * @param {number|string} robloxId 
 * @returns {Promise<string[]>}
 */
async function getWeeklyEventIdsForUser(robloxId) {
    const res = await pool.query(
        `SELECT events FROM ${WEEKLY_EVENTS_INDEX_TABLE} WHERE robloxid = $1`,
        [toId(robloxId)]
    );
    return res.rows[0] && Array.isArray(res.rows[0].events) ? res.rows[0].events : [];
}

/**
 * Get all-time event IDs for a user
 * @param {number|string} robloxId 
 * @returns {Promise<string[]>}
 */
async function getAllTimeEventIdsForUser(robloxId) {
    const res = await pool.query(
        `SELECT events FROM ${ALL_TIME_EVENTS_INDEX_TABLE} WHERE robloxid = $1`,
        [toId(robloxId)]
    );
    return res.rows[0] && Array.isArray(res.rows[0].events) ? res.rows[0].events : [];
}


// Points Logic
/**
 * Increment all-time event points
 * @param {number|string} robloxId 
 * @param {number} delta 
 * @returns {Promise<void>}
 */
async function incrementAllTimeEventPoints(robloxId, delta) {
    const rid = toId(robloxId);
    await pool.query(
        `INSERT INTO ${ALL_TIME_EVENT_POINTS_TABLE} (robloxid, eventpoints)
     VALUES ($1, $2)
     ON CONFLICT (robloxid) DO UPDATE SET eventpoints = ${ALL_TIME_EVENT_POINTS_TABLE}.eventpoints + $2`,
        [rid, Number(delta)]
    );
}

/**
 * Get current event points for user
 * @param {number|string} robloxId 
 * @returns {Promise<number>}
 */
async function getCurrentEventPoints(robloxId) {
    const rid = toId(robloxId);
    const res = await pool.query(
        `SELECT eventpoints FROM ${EVENT_POINTS_TABLE} WHERE robloxid = $1`,
        [rid]
    );
    return res.rows[0] ? Number(res.rows[0].eventpoints) : 0;
}

/**
 * Set current event points (also updates all-time delta)
 * @param {number|string} robloxId 
 * @param {number} points 
 * @returns {Promise<void>}
 */
async function setCurrentEventPoints(robloxId, points) {
    const rid = toId(robloxId);
    const oldPoints = await getCurrentEventPoints(rid);

    await pool.query(
        `INSERT INTO ${EVENT_POINTS_TABLE} (robloxid, eventpoints)
       VALUES ($1, $2)
       ON CONFLICT (robloxid) DO UPDATE SET eventpoints = EXCLUDED.eventpoints`,
        [rid, Number(points)]
    );

    const delta = Number(points) - Number(oldPoints);
    if (delta !== 0) {
        await incrementAllTimeEventPoints(rid, delta);
    }
}

/**
 * Increment current event points (also updates all-time delta)
 * @param {number|string} robloxId 
 * @param {number} delta 
 * @returns {Promise<void>}
 */
async function incrementCurrentEventPoints(robloxId, delta) {
    const rid = toId(robloxId);
    await pool.query(
        `INSERT INTO ${EVENT_POINTS_TABLE} (robloxid, eventpoints)
       VALUES ($1, $2)
       ON CONFLICT (robloxid) DO UPDATE SET eventpoints = ${EVENT_POINTS_TABLE}.eventpoints + $2`,
        [rid, Number(delta)]
    );
    await incrementAllTimeEventPoints(rid, Number(delta));
}

/**
 * Get all-time event points for user
 * @param {number|string} robloxId 
 * @returns {Promise<number>}
 */
async function getAllTimeEventPoints(robloxId) {
    const rid = toId(robloxId);
    const res = await pool.query(
        `SELECT eventpoints FROM ${ALL_TIME_EVENT_POINTS_TABLE} WHERE robloxid = $1`,
        [rid]
    );
    return res.rows[0] ? Number(res.rows[0].eventpoints) : 0;
}

/**
 * Set all-time event points for user
 * @param {number|string} robloxId 
 * @param {number} points 
 * @returns {Promise<void>}
 */
async function setAllTimeEventPoints(robloxId, points) {
    const rid = toId(robloxId);
    await pool.query(
        `INSERT INTO ${ALL_TIME_EVENT_POINTS_TABLE} (robloxid, eventpoints)
       VALUES ($1, $2)
       ON CONFLICT (robloxid) DO UPDATE SET eventpoints = EXCLUDED.eventpoints`,
        [rid, Number(points)]
    );
}

/**
 * Batch get all-time event points
 * @param {string[]} robloxIds 
 * @returns {Promise<{robloxId: string, eventPoints: number}[]>}
 */
async function getAllTimeEventPointsBatch(robloxIds) {
    if (!robloxIds.length) return [];
    const res = await pool.query(
        `SELECT robloxid, eventpoints FROM ${ALL_TIME_EVENT_POINTS_TABLE} WHERE robloxid = ANY($1)`,
        [robloxIds]
    );
    const map = new Map(res.rows.map(r => [String(r.robloxid), Number(r.eventpoints)]));
    return robloxIds.map(id => ({
        robloxId: id,
        eventPoints: map.get(id) || 0
    }));
}

/**
 * Get all users and their all-time points
 * @returns {Promise<{robloxId: string, eventPoints: number}[]>}
 */
async function getAllUsersAllTimeEventPoints() {
    const res = await pool.query(
        `SELECT robloxid, eventpoints FROM ${ALL_TIME_EVENT_POINTS_TABLE}`
    );
    return res.rows.map(row => ({
        robloxId: String(row.robloxid),
        eventPoints: Number(row.eventpoints)
    }));
}

/**
 * Get users who participated in weekly events
 * @returns {Promise<string[]>} List of Roblox IDs
 */
async function getUsersWithWeeklyEvents() {
    const res = await pool.query(
        `SELECT robloxid FROM ${WEEKLY_EVENTS_INDEX_TABLE} WHERE array_length(events, 1) > 0`
    );
    return res.rows.map(r => String(r.robloxid));
}

/**
 * Batch get current event points
 * @param {string[]} robloxIds 
 * @returns {Promise<{robloxId: string, eventPoints: number}[]>}
 */
async function getCurrentEventPointsBatch(robloxIds) {
    if (!robloxIds.length) return [];
    const res = await pool.query(
        `SELECT robloxid, eventpoints FROM ${EVENT_POINTS_TABLE} WHERE robloxid = ANY($1)`,
        [robloxIds]
    );
    const map = new Map(res.rows.map(r => [String(r.robloxid), Number(r.eventpoints)]));
    return robloxIds.map(robloxId => ({
        robloxId,
        eventPoints: map.get(robloxId) || 0
    }));
}

/**
 * Batch get weekly user event IDs
 * @param {string[]} robloxIds 
 * @returns {Promise<{robloxId: string, events: string[]}[]>}
 */
async function getWeeklyUserEventsBatch(robloxIds) {
    if (!robloxIds.length) return [];
    const res = await pool.query(
        `SELECT robloxid, events FROM ${WEEKLY_EVENTS_INDEX_TABLE} WHERE robloxid = ANY($1)`,
        [robloxIds]
    );
    const map = new Map(res.rows.map(r => [String(r.robloxid), r.events]));
    return robloxIds.map(robloxId => ({
        robloxId,
        events: map.get(robloxId) || []
    }));
}

/**
 * Batch get all-time user event IDs
 * @param {string[]} robloxIds 
 * @returns {Promise<{robloxId: string, events: string[]}[]>}
 */
async function getAllTimeUserEventsBatch(robloxIds) {
    if (!robloxIds.length) return [];
    const res = await pool.query(
        `SELECT robloxid, events FROM ${ALL_TIME_EVENTS_INDEX_TABLE} WHERE robloxid = ANY($1)`,
        [robloxIds]
    );
    const map = new Map(res.rows.map(r => [String(r.robloxid), r.events]));
    return robloxIds.map(robloxId => ({
        robloxId,
        events: map.get(robloxId) || []
    }));
}

/**
 * Batch get weekly events
 * @param {string[]} eventIds 
 * @returns {Promise<import('../types').Event[]>}
 */
async function getWeeklyEventsBatch(eventIds) {
    if (!eventIds.length) return [];
    const res = await pool.query(
        `SELECT eventid, type, message, host FROM ${WEEKLY_EVENTS_TABLE} WHERE eventid = ANY($1)`,
        [eventIds]
    );
    const map = new Map(res.rows.map(r => [String(r.eventid), r]));
    return eventIds.map(id => {
        const d = map.get(id) || {};
        return {
            eventId: id,
            type: d.type || null,
            message: d.message || null,
            host: toNumOrNull(d.host)
        };
    });
}

/**
 * Batch get all-time events
 * @param {string[]} eventIds 
 * @returns {Promise<import('../types').Event[]>}
 */
async function getAllTimeEventsBatch(eventIds) {
    if (!eventIds.length) return [];
    const res = await pool.query(
        `SELECT eventid, type, message, host, timestamp FROM ${ALL_TIME_EVENTS_TABLE} WHERE eventid = ANY($1)`,
        [eventIds]
    );
    const map = new Map(res.rows.map(r => [String(r.eventid), r]));
    return eventIds.map(id => {
        const d = map.get(id) || {};
        return {
            eventId: id,
            type: d.type || null,
            message: d.message || null,
            timestamp: d.timestamp || null,
            host: toNumOrNull(d.host)
        };
    });
}

function resetAllEventPoints() {
    return pool.query(`DELETE FROM ${EVENT_POINTS_TABLE}`);
}

module.exports = {
    getEventTypes,
    addEventType,
    removeEventType,
    clearEventTypesCache,
    indexEventForUser,
    unindexEventForUser,
    createWeeklyEvent,
    getWeeklyEvent,
    getAllTimeEventById,
    findEventByMessage,
    updateWeeklyEvent,
    updateWeeklyEventPartial,
    updateAllTimeEvent,
    deleteEventById,
    deleteAllTimeEventById,
    listWeeklyEvents,
    listAllTimeEvents,
    getWeeklyEventIds,
    getWeeklyEventIdsForUser,
    getAllTimeEventIdsForUser,
    incrementAllTimeEventPoints,
    getCurrentEventPoints,
    setCurrentEventPoints,
    incrementCurrentEventPoints,
    getAllTimeEventPoints,
    setAllTimeEventPoints,
    getAllTimeEventPointsBatch,
    getAllUsersAllTimeEventPoints,
    getUsersWithWeeklyEvents,
    getCurrentEventPointsBatch,
    getWeeklyUserEventsBatch,
    getAllTimeUserEventsBatch,
    getWeeklyEventsBatch,
    getAllTimeEventsBatch,
    resetAllEventPoints,
    _eventDataWithUsernames // Export for admin module
};
