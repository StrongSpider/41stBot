'use strict';

// ----------------------------------------
// Imports
// ----------------------------------------
const { POSTGRES_DATABASE, POSTGRES_HOST, POSTGRES_PASSWORD, POSTGRES_PORT, POSTGRES_USER, GOOGLE_APP_URL, GOOGLE_WEBHOOK_SECRET } = require('../../config.json');

const { Pool } = require('pg');

// ----------------------------------------
// Google Sheets webhook (Apps Script) client
// ----------------------------------------
const crypto = require('crypto');
// Prefer global fetch if on Node 18+, otherwise lazy import node-fetch
const fetch = global.fetch ? global.fetch : ((...a) => import('node-fetch').then(({ default: f }) => f(...a)));
// Roblox username lookup helper (uses noblox + local cache)
const { getUsernameFromId } = require('./roblox.js');

function _sheetsIsConfigured() {
  return !!(GOOGLE_APP_URL && GOOGLE_WEBHOOK_SECRET);
}

function _hmacBase64(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

async function _postToSheets(payloadObj) {
  if (!_sheetsIsConfigured()) return { ok: false, skipped: 'sheets webhook not configured' };
  const body = JSON.stringify(payloadObj);
  const sig = _hmacBase64(body, GOOGLE_WEBHOOK_SECRET);
  const url = `${GOOGLE_APP_URL}?sig=${encodeURIComponent(sig)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sheets push failed ${res.status} ${text}`);
  }
  try { return await res.json(); } catch { return { ok: true }; }
}

async function _pushEventToSheetsBoth(ev) {
  return _postToSheets({
    stream: 'both',
    events: [ev],
    batch_id: ev && ev.eventid ? String(ev.eventid) : undefined
  });
}

async function _resetWeeklySheet() {
  return _postToSheets({ op: 'reset_weekly' });
}

// Optional: if Apps Script implements it, clear AllTimeIngest tab too.
async function _resetAllTimeSheet() {
  try {
    return await _postToSheets({ op: 'reset_alltime' });
  } catch (err) {
    const msg = String(err && err.message || '');
    if (msg.includes('4')) return { ok: false, skipped: 'reset_alltime unsupported' };
    throw err;
  }
}

async function _postEventsChunk(stream, eventsChunk) {
  return _postToSheets({
    stream,
    events: eventsChunk
  });
}

// ------------------------
// Roblox ID to Username helpers for Sheets
// ------------------------
async function _idToUsernameSafe(id) {
  const n = Number(id);
  if (!isFinite(n) || n === -1) return '';
  try {
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
  // Remove blanks so attendees become a clean "a,b,c" in the sheet
  const filtered = attendeeNames.filter(Boolean);
  return {
    ...ev,
    host: hostName || '',
    supervisor: supervisorName || '',
    attendees: filtered
  };
}

// ----------------------------------------
// Constants
// ----------------------------------------

// Table names
const ALL_TIME_EVENT_POINTS_TABLE = 'all_time_event_points';
const ALL_TIME_EVENTS_INDEX_TABLE = 'all_time_events_index';
const WEEKLY_EVENTS_INDEX_TABLE = 'weekly_events_index';
const ALL_TIME_EVENTS_TABLE = 'all_time_events';
const WEEKLY_EVENTS_TABLE = 'weekly_events';
const EVENT_POINTS_TABLE = 'event_points';
const EVENT_TYPES_TABLE = 'event_types';
const ROLE_QUOTAS_TABLE = 'role_quotas';
const ROBLOX_IDS_TABLE = 'roblox_ids';
const INACTIVITY_TABLE = 'inactivity';
const BADGES_TABLE = 'badges';
const ASSETS_TABLE = 'assets';
const ASSET_PRICES_TABLE = 'asset_prices';
const GROUPS_TABLE = 'groups';

// ----------------------------------------
// Types (JSDoc)
// ----------------------------------------

/**
 * String Discord ID (numeric ok; coerced to string)
 * @typedef {string} DiscordId
 */

/**
 * String Roblox ID (numeric ok; coerced to string)
 * @typedef {string} RobloxId
 */

/**
 * UUID string for an event
 * @typedef {string} EventId
 */

/**
 * ISO 8601 timestamp string
 * @typedef {string} TimestampISO
 */

/**
 * String Event Type label
 * @typedef {string} EventType
 */

/**
 * @typedef {Object} EventCapItem
 * @property {string} alias
 * @property {string} type
 * @property {number} count
 */

/**
 * @typedef {Object} RoleQuota
 * @property {string} roleId
 * @property {number} quotaEP
 * @property {EventCapItem[]} eventCaps
 * @property {string} overwrites
 * @property {string} exclusive
 * @property {boolean} purges
 */

/**
 * @typedef {Object} InactivityRecord
 * @property {DiscordId} discordId
 * @property {number} date
 * @property {string} reason
 */

/**
 * @typedef {Object} Badge
 * @property {number} badgeId
 * @property {number} placeId
 * @property {number} awardedDate
 */

/**
 * Normalize a JSON-ish value into a clean Badge[].
 * Coerces fields to numbers and drops invalid items.
 * @param {any} raw
 * @returns {Badge[]}
 */
function normalizeBadges(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [];
  /** @type {Badge[]} */
  const out = [];
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue;
    const badgeId = Number(b.badgeId);
    const placeId = Number(b.placeId);
    const awardedDate = Number(b.awardedDate);
    if (!Number.isFinite(badgeId) || !Number.isFinite(placeId) || !Number.isFinite(awardedDate)) continue;
    out.push({ badgeId, placeId, awardedDate });
  }
  return out;
}

/**
 * @typedef {Object} Asset
 * @property {string} type
 * @property {number} assetId
 * @property {number} price
 */

/**
 * @typedef {Object} AssetPrice
 * @property {number} assetId
 * @property {number} price
 */

/**
 * Normalize a JSON-ish value into a clean Asset[].
 * Coerces numeric fields to numbers and drops invalid items.
 * @param {any} raw
 * @returns {Asset[]}
 */
function normalizeAssets(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [];
  /** @type {Asset[]} */
  const out = [];
  for (const a of arr) {
    if (!a || typeof a !== 'object') continue;
    const type = typeof a.type === 'string' ? a.type : '';
    const assetId = Number(a.assetId);
    const price = Number(a.price);
    if (!type || !Number.isFinite(assetId) || !Number.isFinite(price)) continue;
    out.push({ type, assetId, price });
  }
  return out;
}

/**
 * @typedef {Object} GroupRole
 * @property {string} id
 * @property {number} rank
 */

/**
 * Normalize a JSON-ish value into a clean GroupRole[].
 * Coerces fields and drops invalid items.
 * @param {any} raw
 * @returns {GroupRole[]}
 */
function normalizeGroupRoles(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [];
  /** @type {GroupRole[]} */
  const out = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id);
    const rank = Number(r.rank);
    if (!id || !Number.isFinite(rank)) continue;
    out.push({ id, rank });
  }
  return out;
}

/**
 * @typedef {Object} Group
 * @property {string} groupid
 * @property {GroupRole[]} roles
 * @property {TimestampISO} expires
 */

/**
 * @typedef {Object} EventData
 * @property {EventId} eventid
 * @property {number[]} attendees
 * @property {number} host
 * @property {number} supervisor
 * @property {TimestampISO} timestamp
 * @property {string} type
 * @property {string} message
 */

// ----------------------------------------
// Pool Initialization
// ----------------------------------------
/** @type {Pool} */
const pool = new Pool({
  user: POSTGRES_USER,
  host: POSTGRES_HOST,
  database: POSTGRES_DATABASE,
  password: POSTGRES_PASSWORD,
  port: POSTGRES_PORT
});

// ----------------------------------------
// Helpers
// ----------------------------------------

/**
 * Ensure a timestamp-like value returns an ISO string.
 * @param {number|string|Date} val
 * @returns {TimestampISO}
 */
function ensureTimestamp(val) {
  if (typeof val === 'number') return new Date(val).toISOString();
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return new Date(parsed).toISOString();
    throw new Error('Invalid timestamp value: ' + val);
  }
  if (val instanceof Date) return val.toISOString();
  throw new Error('Invalid timestamp value');
}

/**
 * Normalize any input ID to a string.
 * @param {string|number} id
 * @returns {string}
 */
function toId(id) {
  return String(id);
}

/**
 * Convert possibly-nullish number-like to number or null.
 * @param {any} v
 * @returns {number|null}
 */
function toNumOrNull(v) {
  return v === null || v === undefined ? null : Number(v);
}

/**
 * Normalize eventCaps from DB to EventCapItem[].
 * @param {any} raw
 * @returns {EventCapItem[]}
 */
function normalizeEventCaps(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

// ======================================================================
// Event Types (with local cache)
// ======================================================================

/** Cache TTL for event types (ms). */
const EVENT_TYPES_CACHE_TTL_MS = 60_000;

/**
 * @typedef {Object} _EventTypesCache
 * @property {string[]} data
 * @property {number} expiresAt
 */

/** @type {_EventTypesCache|null} */
let _eventTypesCache = null;
/** @type {Promise<string[]>|null} */
let _eventTypesInFlight = null;

/**
 * Load event types from the database.
 * @returns {Promise<string[]>}
 */
async function _loadEventTypesFromDb() {
  const res = await pool.query(`SELECT type FROM ${EVENT_TYPES_TABLE}`);
  return res.rows.map(r => String(r.type));
}

/**
 * Normalize and sanity-check a candidate event_type string.
 * Throws on anything suspicious; returns the cleaned string otherwise.
 * Still use parameterized queries after this.
 * @param {unknown} value
 * @returns {string}
 */
function assertSafeEventType(value) {
  if (typeof value !== 'string') throw new Error('event_type must be a string');

  // 1) Fast length and ASCII controls
  if (value.length === 0 || value.length > 64) throw new Error('invalid event_type length');
  // Disallow non-ASCII, control chars, and zero-width/invisible weirdness
  // (only printable ASCII 0x20-0x7E)
  if (!/^[\x20-\x7E]+$/.test(value)) throw new Error('invalid characters in event_type');

  // 2) Hard allow-list of characters you actually need
  // Adjust if you truly need others.
  if (!/^[A-Za-z0-9._\- ]+$/.test(value)) throw new Error('event_type contains disallowed characters');

  // 3) Heuristic injection detectors (blacklist, belt-and-suspenders)
  // Metacharacters and SQL comment tokens that should never appear here
  const badFragments = [
    '--', '/*', '*/', ';', '\\', '\'', '"', '`', '$$', '::', '%', '_'
  ];
  for (const frag of badFragments) {
    if (value.includes(frag)) throw new Error('possible SQL injection detected (meta-character)');
  }

  // 4) Keyword tripwires (word-boundary, case-insensitive)
  // These should never be valid event_type values.
  const keywordRx = /\b(select|union|insert|update|delete|drop|alter|create|grant|revoke|truncate|execute|exec|call|copy|do|or|and)\b/i;
  if (keywordRx.test(value)) throw new Error('possible SQL injection detected (keyword)');

  return value;
}

/**
 * Get all event types. Uses local cache for speed.
 * @param {{refresh?: boolean}} [opts]
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
 * Add an event type. No-op if it already exists. Updates cache eagerly.
 * @param {EventType} type
 * @returns {Promise<EventType>}
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
 * Remove an event type. Updates cache eagerly.
 * @param {EventType} type
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

/**
 * Clear the local event types cache.
 */
function clearEventTypesCache() {
  _eventTypesCache = null;
  _eventTypesInFlight = null;
}

// ======================================================================
// Roblox ID Management
// ======================================================================

/**
 * Get a user's Roblox ID by Discord ID.
 * @param {DiscordId|number} discordId
 * @returns {Promise<number|null>}
 */
async function getRobloxIdByDiscord(discordId) {
  const res = await pool.query(
    `SELECT robloxid FROM ${ROBLOX_IDS_TABLE} WHERE discordid = $1`,
    [toId(discordId)]
  );
  return res.rows[0] ? Number(res.rows[0].robloxid) : null;
}

/**
 * Get a user's Discord ID by Roblox ID.
 * @param {RobloxId|number} robloxId
 * @returns {Promise<DiscordId|null>}
 */
async function getDiscordIdByRoblox(robloxId) {
  const res = await pool.query(
    `SELECT discordid FROM ${ROBLOX_IDS_TABLE} WHERE robloxid = $1`,
    [toId(robloxId)]
  );
  return res.rows[0] ? String(res.rows[0].discordid) : null;
}

/**
 * Upsert a Roblox ID for a Discord ID.
 * @param {DiscordId|number} discordId
 * @param {RobloxId|number} robloxId
 * @returns {Promise<void>}
 */
async function upsertRobloxId(discordId, robloxId) {
  await pool.query(
    `INSERT INTO ${ROBLOX_IDS_TABLE} (discordid, robloxid)
     VALUES ($1, $2)
     ON CONFLICT (discordid) DO UPDATE SET robloxid = EXCLUDED.robloxid`,
    [toId(discordId), toId(robloxId)]
  );
}

/**
 * Deletes a row entry from a Discord ID.
 * @param {DiscordId|number} discordId
 * @returns {Promise<void>}
 */
async function deleteDiscordId(discordId) {
  await pool.query(
    `DELETE FROM ${ROBLOX_IDS_TABLE} WHERE discordid = $1`,
    [toId(discordId)]
  );
}

// ======================================================================
// Inactivity
// ======================================================================

/**
 * Get inactivity for a single user.
 * @param {DiscordId|number} discordId
 * @returns {Promise<InactivityRecord|null>}
 */
async function getInactivity(discordId) {
  const res = await pool.query(
    `SELECT date, reason FROM ${INACTIVITY_TABLE} WHERE discordid = $1`,
    [toId(discordId)]
  );
  if (!res.rows.length) return null;
  return {
    discordId: toId(discordId),
    date: res.rows[0].date ? Number(res.rows[0].date) : 0,
    reason: res.rows[0].reason || 'NO REASON PROVIDED'
  };
}

/**
 * Get all active inactivity notices.
 * @returns {Promise<InactivityRecord[]|null>}
 */
async function getAllInactivities() {
  const res = await pool.query(`SELECT * FROM ${INACTIVITY_TABLE}`);
  if (!res.rows.length) return null;
  return res.rows.map(r => ({
    discordId: String(r.discordid),
    date: r.date ? Number(r.date) : 0,
    reason: r.reason || 'NO REASON PROVIDED'
  }));
}

/**
 * Set inactivity for a user (upsert).
 * @param {DiscordId|number} discordId
 * @param {number} date
 * @param {string} reason
 * @returns {Promise<void>}
 */
async function setInactivity(discordId, date, reason) {
  await pool.query(
    `INSERT INTO ${INACTIVITY_TABLE} (discordid, date, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (discordid) DO UPDATE SET date = EXCLUDED.date, reason = EXCLUDED.reason`,
    [toId(discordId), Number(date), reason]
  );
}

/**
 * Delete a user's inactivity record.
 * @param {DiscordId|number} discordId
 * @returns {Promise<void>}
 */
async function deleteInactivity(discordId) {
  await pool.query(
    `DELETE FROM ${INACTIVITY_TABLE} WHERE discordid = $1`,
    [toId(discordId)]
  );
}

// ======================================================================
// User Events Index (weekly and all-time)
// ======================================================================

/**
 * Get weekly event IDs for a user.
 * @param {RobloxId|number} robloxId
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
 * Get alltime event IDs for a user.
 * @param {RobloxId|number} robloxId
 * @returns {Promise<string[]>}
 */
async function getAllTimeEventIdsForUser(robloxId) {
  const res = await pool.query(
    `SELECT events FROM ${ALL_TIME_EVENTS_INDEX_TABLE} WHERE robloxid = $1`,
    [toId(robloxId)]
  );
  return res.rows[0] && Array.isArray(res.rows[0].events) ? res.rows[0].events : [];
}


/**
 * Add an event ID to a user's weekly and all-time index (no duplicates).
 * @param {RobloxId|number} robloxId
 * @param {EventId} eventId
 * @returns {Promise<void>}
 */
async function indexEventForUser(robloxId, eventId) {
  const rid = toId(robloxId);
  await pool.query(
    `INSERT INTO ${WEEKLY_EVENTS_INDEX_TABLE} (robloxid, events)
     VALUES ($1, ARRAY[$2])
     ON CONFLICT (robloxid) DO UPDATE
       SET events = array_append(${WEEKLY_EVENTS_INDEX_TABLE}.events, $2)
     WHERE NOT (${WEEKLY_EVENTS_INDEX_TABLE}.events @> ARRAY[$2])`,
    [rid, String(eventId)]
  );
  await pool.query(
    `INSERT INTO ${ALL_TIME_EVENTS_INDEX_TABLE} (robloxid, events)
     VALUES ($1, ARRAY[$2])
     ON CONFLICT (robloxid) DO UPDATE
       SET events = array_append(${ALL_TIME_EVENTS_INDEX_TABLE}.events, $2)
     WHERE NOT (${ALL_TIME_EVENTS_INDEX_TABLE}.events @> ARRAY[$2])`,
    [rid, String(eventId)]
  );
}

/**
 * Remove an event ID from a user's indexes.
 * @param {RobloxId|number} robloxId
 * @param {EventId} eventId
 * @returns {Promise<void>}
 */
async function unindexEventForUser(robloxId, eventId) {
  const rid = toId(robloxId);
  await pool.query(
    `UPDATE ${WEEKLY_EVENTS_INDEX_TABLE} SET events = array_remove(events, $2) WHERE robloxid = $1`,
    [rid, String(eventId)]
  );
  await pool.query(
    `UPDATE ${ALL_TIME_EVENTS_INDEX_TABLE} SET events = array_remove(events, $2) WHERE robloxid = $1`,
    [rid, String(eventId)]
  );
}

// ======================================================================
// Event Points (current and all-time)
// ======================================================================

/**
 * Get a user's current event points.
 * @param {RobloxId|number} robloxId
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
 * Set a user's current event points and sync delta to all-time.
 * @param {RobloxId|number} robloxId
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
 * Increment a user's current points and all-time total.
 * @param {RobloxId|number} robloxId
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
 * Get a user's all-time event points.
 * @param {RobloxId|number} robloxId
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
 * Set a user's all-time event points.
 * @param {RobloxId|number} robloxId
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
 * Increment a user's all-time event points.
 * @param {RobloxId|number} robloxId
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
 * Get all-time points for specific users.
 * @param {RobloxId[]} robloxIds
 * @returns {Promise<Array<{robloxId:RobloxId,eventPoints:number}>>}
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
 * Get all users' all-time event points.
 * @returns {Promise<Array<{robloxId:RobloxId,eventPoints:number}>>}
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

// ======================================================================
// Weekly & All-time Events
// ======================================================================

/**
 * Create a weekly event, mirror to history, and index attendees + host.
 * @param {EventData} data
 * @returns {Promise<EventId>}
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

  // Notify Sheets webhook with the created event (append to WeeklyIngest and AllTimeIngest)
  // try {
  //   const ev = await getAllTimeEventById(eventId); // EventData shape
  //   if (ev) {
  //     const evUser = await _eventDataWithUsernames(ev);
  //     await _pushEventToSheetsBoth(evUser);
  //   }
  // } catch (e) {
  //   console.error('[sheets] push new event failed', e && e.message ? e.message : e);
  // }

  return eventId;
}

/**
 * Get a weekly event by ID.
 * @param {EventId} eventId
 * @returns {Promise<EventData|null>}
 */
async function getWeeklyEvent(eventId) {
  const res = await pool.query(
    `SELECT * FROM ${WEEKLY_EVENTS_TABLE} WHERE eventid = $1`,
    [String(eventId)]
  );
  if (!res.rows[0]) return null;

  const d = res.rows[0];
  d.attendees = (d.attendees || []).map(e => Number(e));
  d.host = Number(d.host);
  d.supervisor = Number(d.supervisor);
  d.timestamp = ensureTimestamp(d.timestamp);
  return d;
}

/**
 * Find an event (any time) by its message URL.
 * @param {string} messageUrl
 * @returns {Promise<EventData|null>}
 */
async function findEventByMessage(messageUrl) {
  const res = await pool.query(
    `SELECT * FROM ${ALL_TIME_EVENTS_TABLE} WHERE message = $1 LIMIT 1`,
    [messageUrl]
  );
  if (!res.rows[0]) return null;

  const d = res.rows[0];
  d.attendees = (d.attendees || []).map(e => Number(e));
  d.host = Number(d.host);
  d.supervisor = Number(d.supervisor);
  d.timestamp = ensureTimestamp(d.timestamp);
  return d;
}

/**
 * Update fields on a weekly event and mirror to all-time. Sync indexes if attendees changed.
 * @param {EventId} eventId
 * @param {Partial<EventData>} updates
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

/**
 * Backward-compatible wrapper for partial weekly updates.
 * @param {EventId} eventId
 * @param {Partial<EventData>} updates
 * @returns {Promise<void>}
 */
async function updateWeeklyEventPartial(eventId, updates) {
  return updateWeeklyEvent(eventId, updates);
}

/**
 * Get an all-time event by ID.
 * @param {EventId} eventId
 * @returns {Promise<EventData|null>}
 */
async function getAllTimeEventById(eventId) {
  const res = await pool.query(
    `SELECT * FROM ${ALL_TIME_EVENTS_TABLE} WHERE eventid = $1`,
    [String(eventId)]
  );
  if (!res.rows[0]) return null;

  const d = res.rows[0];
  d.attendees = (d.attendees || []).map(e => Number(e));
  d.host = Number(d.host);
  d.supervisor = Number(d.supervisor);
  d.timestamp = ensureTimestamp(d.timestamp);
  return d;
}

/**
 * Update an all-time event and mirror to weekly.
 * @param {EventId} eventId
 * @param {Partial<EventData>} updates
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
 * Delete a weekly event; if not found weekly, delete from all-time. Unlink indexes.
 * @param {EventId} eventId
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
 * Delete an all-time event and its weekly mirror, then unlink users.
 * @param {EventId} eventId
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
 * List all weekly events.
 * @returns {Promise<EventData[]>}
 */
async function listWeeklyEvents() {
  const res = await pool.query(`SELECT * FROM ${WEEKLY_EVENTS_TABLE}`);
  return res.rows.map(row => ({
    eventid: String(row.eventid),
    attendees: (row.attendees || []).map(e => Number(e)),
    host: Number(row.host),
    supervisor: Number(row.supervisor),
    timestamp: ensureTimestamp(row.timestamp),
    type: row.type,
    message: row.message
  }));
}

/**
 * Get all weekly event IDs.
 * @returns {Promise<EventId[]>}
 */
async function getWeeklyEventIds() {
  const res = await pool.query(`SELECT eventid FROM ${WEEKLY_EVENTS_TABLE}`);
  return res.rows.map(r => String(r.eventid));
}

/**
 * List all all-time events.
 * @returns {Promise<EventData[]>}
 */
async function listAllTimeEvents() {
  const res = await pool.query(`SELECT * FROM ${ALL_TIME_EVENTS_TABLE}`);
  return res.rows.map(row => ({
    eventid: String(row.eventid),
    attendees: (row.attendees || []).map(e => Number(e)),
    host: Number(row.host),
    supervisor: Number(row.supervisor),
    timestamp: ensureTimestamp(row.timestamp),
    type: row.type,
    message: row.message
  }));
}

// ======================================================================
// Batch and Utility
// ======================================================================

/**
 * Get users that currently have at least one weekly event in their index.
 * @returns {Promise<RobloxId[]>}
 */
async function getUsersWithWeeklyEvents() {
  const res = await pool.query(
    `SELECT robloxid FROM ${WEEKLY_EVENTS_INDEX_TABLE} WHERE array_length(events, 1) > 0`
  );
  return res.rows.map(r => String(r.robloxid));
}

/**
 * Get current event points for a batch of users.
 * @param {RobloxId[]} robloxIds
 * @returns {Promise<Array<{robloxId:RobloxId,eventPoints:number}>>}
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
 * Get weekly event IDs for a batch of users.
 * @param {RobloxId[]} robloxIds
 * @returns {Promise<Array<{robloxId:RobloxId,events:string[]}>>}
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
 * Get all-time event IDs for a batch of users.
 * @param {RobloxId[]} robloxIds
 * @returns {Promise<Array<{robloxId:RobloxId,events:string[]}>>}
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
 * Get minimal weekly event data for a set of event IDs.
 * @param {EventId[]} eventIds
 * @returns {Promise<Array<{eventid:EventId,type:string|null,message:string|null,host:number|null}>>}
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
      eventid: id,
      type: d.type || null,
      message: d.message || null,
      host: toNumOrNull(d.host)
    };
  });
}

/**
 * Get minimal all-time event data for a set of event IDs.
 * @param {EventId[]} eventIds
 * @returns {Promise<Array<{eventid:EventId,type:string|null,message:string|null,host:number|null}>>}
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
      eventid: id,
      type: d.type || null,
      message: d.message || null,
      timestamp: d.timestamp || null,
      host: toNumOrNull(d.host)
    };
  });
}

/**
 * Get Discord IDs for a set of Roblox IDs.
 * @param {RobloxId[]} robloxIds
 * @returns {Promise<Array<{robloxId:RobloxId,discordId:DiscordId|null}>>}
 */
async function getDiscordIdsBatch(robloxIds) {
  if (!robloxIds.length) return [];
  const res = await pool.query(
    `SELECT robloxid, discordid FROM ${ROBLOX_IDS_TABLE} WHERE robloxid = ANY($1)`,
    [robloxIds]
  );
  const map = new Map(res.rows.map(r => [String(r.robloxid), String(r.discordid)]));
  return robloxIds.map(rid => ({
    robloxId: rid,
    discordId: map.get(rid) || null
  }));
}

/**
 * Get all users (Roblox <-> Discord pairs).
 * @returns {Promise<Array<{robloxId:RobloxId,discordId:DiscordId}>>}
 */
async function getAllUsers() {
  const res = await pool.query(
    `SELECT robloxid, discordid FROM ${ROBLOX_IDS_TABLE}`
  );
  return res.rows.map(r => ({
    robloxId: String(r.robloxid),
    discordId: String(r.discordid)
  }));
}

// ======================================================================
// Badges (per-user badge JSONB)
// ======================================================================

/**
 * Get all badges for a user.
 * For large arrays this pulls a single JSONB document, which is efficient
 * as a single row/indexed lookup on (robloxid).
 * @param {RobloxId|number} robloxId
 * @returns {Promise<Badge[]>}
 */
async function getUserBadges(robloxId) {
  const res = await pool.query(
    `SELECT data FROM ${BADGES_TABLE} WHERE robloxid = $1`,
    [toId(robloxId)]
  );
  const row = res.rows[0];
  return normalizeBadges(row && row.data);
}

/**
 * Overwrite a user's badges document (insert-or-update).
 * Sends the JSON once over the wire and lets Postgres store it as JSONB.
 * Prefer this when you already have the full badge list in memory.
 * @param {RobloxId|number} robloxId
 * @param {Badge[]} badges
 * @returns {Promise<void>}
 */
async function setUserBadges(robloxId, badges) {
  const cleaned = normalizeBadges(badges);
  await pool.query(
    `INSERT INTO ${BADGES_TABLE} (robloxid, data)
     VALUES ($1, $2)
     ON CONFLICT (robloxid) DO UPDATE SET data = EXCLUDED.data`,
    [toId(robloxId), JSON.stringify(cleaned)]
  );
}

/**
 * Append badges to a user's badge array without re-reading it.
 * Uses JSONB array concatenation so only the delta crosses the wire,
 * which is preferable when rows can be thousands of elements long.
 * @param {RobloxId|number} robloxId
 * @param {Badge[]} badges
 * @returns {Promise<void>}
 */
async function appendUserBadges(robloxId, badges) {
  const cleaned = normalizeBadges(badges);
  if (!cleaned.length) return;
  await pool.query(
    `INSERT INTO ${BADGES_TABLE} (robloxid, data)
     VALUES ($1, $2)
     ON CONFLICT (robloxid) DO UPDATE
       SET data = ${BADGES_TABLE}.data || EXCLUDED.data`,
    [toId(robloxId), JSON.stringify(cleaned)]
  );
}

// ======================================================================
// Assets (per-user assets JSONB)
// ======================================================================

/**
 * Get all assets for a user.
 * Stored in a single JSONB document keyed by robloxid.
 * @param {RobloxId|number} robloxId
 * @returns {Promise<Asset[]>}
 */
async function getUserAssets(robloxId) {
  const res = await pool.query(
    `SELECT data FROM ${ASSETS_TABLE} WHERE robloxid = $1`,
    [toId(robloxId)]
  );
  const row = res.rows[0];
  return normalizeAssets(row && row.data);
}

/**
 * Overwrite a user's assets document (insert-or-update).
 * Prefer this when you already have the full asset list in memory.
 * @param {RobloxId|number} robloxId
 * @param {Asset[]} assets
 * @returns {Promise<void>}
 */
async function setUserAssets(robloxId, assets) {
  const cleaned = normalizeAssets(assets);
  await pool.query(
    `INSERT INTO ${ASSETS_TABLE} (robloxid, data)
     VALUES ($1, $2)
     ON CONFLICT (robloxid) DO UPDATE SET data = EXCLUDED.data`,
    [toId(robloxId), JSON.stringify(cleaned)]
  );
}

/**
 * Append assets to a user's asset array without re-reading it.
 * Uses JSONB array concatenation so only the delta crosses the wire.
 * @param {RobloxId|number} robloxId
 * @param {Asset[]} assets
 * @returns {Promise<void>}
 */
async function appendUserAssets(robloxId, assets) {
  const cleaned = normalizeAssets(assets);
  if (!cleaned.length) return;
  await pool.query(
    `INSERT INTO ${ASSETS_TABLE} (robloxid, data)
     VALUES ($1, $2)
     ON CONFLICT (robloxid) DO UPDATE
       SET data = ${ASSETS_TABLE}.data || EXCLUDED.data`,
    [toId(robloxId), JSON.stringify(cleaned)]
  );
}

// ======================================================================
// Asset Prices (global prices per asset)
// ======================================================================

/**
 * Get the price for a single asset.
 * @param {number|string} assetId
 * @returns {Promise<number|null>}
 */
async function getAssetPrice(assetId) {
  const res = await pool.query(
    `SELECT price FROM ${ASSET_PRICES_TABLE} WHERE assetid = $1`,
    [toId(assetId)]
  );
  if (!res.rows[0]) return null;
  // assetid and price are BIGINT in Postgres, which pg returns as strings by default.
  return Number(res.rows[0].price);
}

/**
 * Upsert the price for a single asset.
 * @param {number|string} assetId
 * @param {number|string} price
 * @returns {Promise<void>}
 */
async function setAssetPrice(assetId, price) {
  await pool.query(
    `INSERT INTO ${ASSET_PRICES_TABLE} (assetid, price)
     VALUES ($1, $2)
     ON CONFLICT (assetid) DO UPDATE SET price = EXCLUDED.price`,
    [toId(assetId), Number(price)]
  );
}

/**
 * Get prices for a batch of asset IDs.
 * @param {(number|string)[]} assetIds
 * @returns {Promise<Array<{assetId:number|string,price:number|null}>>}
 */
async function getAssetPricesBatch(assetIds) {
  if (!assetIds.length) return [];
  const ids = assetIds.map(toId);
  const res = await pool.query(
    `SELECT assetid, price FROM ${ASSET_PRICES_TABLE} WHERE assetid = ANY($1)`,
    [ids]
  );
  const map = new Map(res.rows.map(r => [String(r.assetid), Number(r.price)]));
  return assetIds.map(id => {
    const key = toId(id);
    return {
      assetId: id,
      price: map.has(key) ? map.get(key) : null
    };
  });
}

/**
 * List all asset prices.
 * @returns {Promise<AssetPrice[]>}
 */
async function listAssetPrices() {
  const res = await pool.query(
    `SELECT assetid, price FROM ${ASSET_PRICES_TABLE}`
  );
  return res.rows.map(row => ({
    assetId: Number(row.assetid),
    price: Number(row.price)
  }));
}

// ======================================================================
// Role Quotas
// ======================================================================

/**
 * Upsert a role's quota and caps.
 * eventCaps is serialized on write; parsed back to EventCapItem[] on read.
 * @param {string} roleId
 * @param {number} quotaEP
 * @param {EventCapItem[]} eventCaps
 * @param {string} overwrites
 * @param {string} exclusive
 * @param {boolean} purges
 * @returns {Promise<void>}
 */
async function setRoleQuota(roleId, quotaEP, eventCaps, overwrites, exclusive, purges) {
  const eventCapsJson = JSON.stringify(eventCaps || []);
  await pool.query(
    `INSERT INTO ${ROLE_QUOTAS_TABLE} (roleid, quotaep, eventcaps, overwrites, exclusive, purges)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (roleid) DO UPDATE SET
       quotaep    = EXCLUDED.quotaep,
       eventcaps  = EXCLUDED.eventcaps,
       overwrites = EXCLUDED.overwrites,
       exclusive  = EXCLUDED.exclusive,
       purges  = EXCLUDED.purges`,
    [roleId, Number(quotaEP), eventCapsJson, String(overwrites), String(exclusive), Boolean(purges)]
  );
}

/**
 * Get a role's quota.
 * @param {string} roleId
 * @returns {Promise<RoleQuota|null>}
 */
async function getRoleQuota(roleId) {
  const res = await pool.query(
    `SELECT roleid, quotaep, eventcaps, overwrites, exclusive, purges FROM ${ROLE_QUOTAS_TABLE} WHERE roleid = $1`,
    [roleId]
  );
  if (!res.rows[0]) return null;
  return {
    roleId: String(res.rows[0].roleid),
    quotaEP: Number(res.rows[0].quotaep),
    eventCaps: normalizeEventCaps(res.rows[0].eventcaps),
    overwrites: String(res.rows[0].overwrites ?? ''),
    purges: Boolean(res.rows[0].purges)
  };
}

/**
 * List all role quotas.
 * @returns {Promise<RoleQuota[]>}
 */
async function listRoleQuotas() {
  const res = await pool.query(
    `SELECT roleid, quotaep, eventcaps, overwrites, purges FROM ${ROLE_QUOTAS_TABLE}`
  );
  return res.rows.map(row => ({
    roleId: String(row.roleid),
    quotaEP: Number(row.quotaep),
    eventCaps: normalizeEventCaps(row.eventcaps),
    overwrites: String(row.overwrites ?? ''),
    purges: Boolean(res.rows[0].purges)
  }));
}

/**
 * Delete a role quota by role ID.
 * @param {string} roleId
 * @returns {Promise<void>}
 */
async function deleteRoleQuota(roleId) {
  await pool.query(
    `DELETE FROM ${ROLE_QUOTAS_TABLE} WHERE roleid = $1`,
    [roleId]
  );
}

// ======================================================================
// Groups
// ======================================================================

/**
 * Get a group by ID.
 * @param {string|number} groupId
 * @returns {Promise<Group|null>}
 */
async function getGroup(groupId) {
  const res = await pool.query(
    `SELECT groupid, roles, expires FROM ${GROUPS_TABLE} WHERE groupid = $1`,
    [toId(groupId)]
  );
  if (!res.rows[0]) return null;
  return {
    groupid: String(res.rows[0].groupid),
    roles: normalizeGroupRoles(res.rows[0].roles),
    expires: ensureTimestamp(res.rows[0].expires)
  };
}

/**
 * Create a new group.
 * @param {string|number} groupId
 * @param {GroupRole[]} roles
 * @param {string|number|Date} expires
 * @returns {Promise<void>}
 */
async function createGroup(groupId, roles, expires) {
  const cleanedRoles = normalizeGroupRoles(roles);
  const expiresTs = ensureTimestamp(expires);
  await pool.query(
    `INSERT INTO ${GROUPS_TABLE} (groupid, roles, expires)
     VALUES ($1, $2, $3)`,
    [toId(groupId), JSON.stringify(cleanedRoles), expiresTs]
  );
}

/**
 * Update a group.
 * @param {string|number} groupId
 * @param {Partial<Group>} updates
 * @returns {Promise<void>}
 */
async function updateGroup(groupId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (updates.roles !== undefined) {
    fields.push(`roles = $${idx++}`);
    values.push(JSON.stringify(normalizeGroupRoles(updates.roles)));
  }
  if (updates.expires !== undefined) {
    fields.push(`expires = $${idx++}`);
    values.push(ensureTimestamp(updates.expires));
  }

  if (fields.length === 0) return;

  values.push(toId(groupId));
  const setClause = fields.join(', ');

  await pool.query(
    `UPDATE ${GROUPS_TABLE} SET ${setClause} WHERE groupid = $${idx}`,
    values
  );
}

/**
 * Delete a group.
 * @param {string|number} groupId
 * @returns {Promise<void>}
 */
async function deleteGroup(groupId) {
  await pool.query(
    `DELETE FROM ${GROUPS_TABLE} WHERE groupid = $1`,
    [toId(groupId)]
  );
}

/**
 * List all groups.
 * @returns {Promise<Group[]>}
 */
async function listGroups() {
  const res = await pool.query(`SELECT groupid, roles, expires FROM ${GROUPS_TABLE}`);
  return res.rows.map(row => ({
    groupid: String(row.groupid),
    roles: normalizeGroupRoles(row.roles),
    expires: ensureTimestamp(row.expires)
  }));
}

// ======================================================================
// Admin / Maintenance
// ======================================================================

/**
 * Clear all weekly events and their user indexes. Does not touch all-time.
 * @returns {Promise<void>}
 */
async function clearAllWeeklyEvents() {
  await pool.query(`DELETE FROM ${WEEKLY_EVENTS_TABLE}`);
  await pool.query(`DELETE FROM ${WEEKLY_EVENTS_INDEX_TABLE}`);
  // try {
  //   await _resetWeeklySheet();
  // } catch (e) {
  //   console.error('[sheets] reset weekly sheet failed', e && e.message ? e.message : e);
  // }
}

/**
 * Reset all current event points. Does not touch all-time.
 * @returns {Promise<void>}
 */
async function resetAllEventPoints() {
  await pool.query(`DELETE FROM ${EVENT_POINTS_TABLE}`);
}

/**
 * Overwrite both Google Sheets ingest tabs with data from Postgres.
 * - Clears WeeklyIngest (op=reset_weekly)
 * - Attempts to clear AllTimeIngest (op=reset_alltime) if supported
 * - Streams all weekly and all-time events in chunks
 * Env: APPS_SCRIPT_URL, WEBHOOK_SECRET
 * @param {{chunkSize?: number, log?: (msg:string)=>void}} [opts]
 * @returns {Promise<{weeklyInserted:number, allTimeInserted:number}>}
 */
async function overwriteSheetsFromDb(opts) {
  const chunkSize = (opts && opts.chunkSize) || 400;
  const log = (opts && opts.log) || ((m) => console.log('[sheets-sync]', m));
  if (!_sheetsIsConfigured()) throw new Error('APPS_SCRIPT_URL and WEBHOOK_SECRET must be set');

  log('clearing WeeklyIngest...');
  try { await _resetWeeklySheet(); } catch (e) { log(`warning: reset_weekly failed: ${e && e.message ? e.message : e}`); }

  log('clearing AllTimeIngest (best-effort)...');
  try { await _resetAllTimeSheet(); } catch (e) { log(`warning: reset_alltime unsupported or failed: ${e && e.message ? e.message : e}`); }

  log('loading events from Postgres...');
  const [weekly, alltime] = await Promise.all([listWeeklyEvents(), listAllTimeEvents()]);

  let weeklyInserted = 0;
  let allTimeInserted = 0;

  for (let i = 0; i < weekly.length; i += chunkSize) {
    const chunk = weekly.slice(i, i + chunkSize);
    const chunkUser = await Promise.all(chunk.map(_eventDataWithUsernames));
    await _postEventsChunk('weekly', chunkUser);
    weeklyInserted += chunk.length;
    log(`weekly: ${weeklyInserted}/${weekly.length}`);
  }

  for (let i = 0; i < alltime.length; i += chunkSize) {
    const chunk = alltime.slice(i, i + chunkSize);
    const chunkUser = await Promise.all(chunk.map(_eventDataWithUsernames));
    await _postEventsChunk('alltime', chunkUser);
    allTimeInserted += chunk.length;
    log(`alltime: ${allTimeInserted}/${alltime.length}`);
  }

  log('done');
  return { weeklyInserted, allTimeInserted };
}

// ----------------------------------------
// Exports
// ----------------------------------------
module.exports = {
  // data/constants
  ensureTimestamp,

  // new names
  getRobloxIdByDiscord,
  getDiscordIdByRoblox,
  upsertRobloxId,
  deleteDiscordId,

  getInactivity,
  setInactivity,
  deleteInactivity,
  getAllInactivities,

  getWeeklyEventIdsForUser,
  indexEventForUser,
  unindexEventForUser,

  getCurrentEventPoints,
  setCurrentEventPoints,
  incrementCurrentEventPoints,

  getAllTimeEventPoints,
  setAllTimeEventPoints,
  incrementAllTimeEventPoints,
  getAllTimeEventPointsBatch,
  getAllUsersAllTimeEventPoints,
  getAllTimeEventIdsForUser,

  createWeeklyEvent,
  getWeeklyEvent,
  findEventByMessage,
  updateWeeklyEvent,
  updateWeeklyEventPartial,

  deleteEventById,

  getAllTimeEventById,
  updateAllTimeEvent,
  deleteAllTimeEventById,

  listWeeklyEvents,
  getWeeklyEventIds,
  listAllTimeEvents,

  clearAllWeeklyEvents,
  resetAllEventPoints,

  overwriteSheetsFromDb,

  getUsersWithWeeklyEvents,
  getCurrentEventPointsBatch,
  getWeeklyUserEventsBatch,
  getAllTimeUserEventsBatch,
  getWeeklyEventsBatch,
  getAllTimeEventsBatch,

  getDiscordIdsBatch,
  getAllUsers,

  // badges
  getUserBadges,
  setUserBadges,
  appendUserBadges,

  // assets
  getUserAssets,
  setUserAssets,
  appendUserAssets,

  // asset prices
  getAssetPrice,
  setAssetPrice,
  getAssetPricesBatch,
  listAssetPrices,

  setRoleQuota,
  getRoleQuota,
  listRoleQuotas,
  deleteRoleQuota,

  // event types
  getEventTypes,
  addEventType,
  removeEventType,
  clearEventTypesCache,

  // groups
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  listGroups,
};