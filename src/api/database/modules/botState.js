'use strict';

const { pool } = require('../connection');
const { BOT_STATE_TABLE } = require('../constants');

const EVENT_EP_LOCK_KEY = 'event_ep_lock';

let _ensureBotStateTablePromise = null;

function normalizeBotStateKey(key) {
    const normalizedKey = typeof key === 'string' ? key.trim() : '';
    if (!normalizedKey) {
        throw new TypeError('Bot state key must be a non-empty string.');
    }
    return normalizedKey;
}

function ensureBotStateTable() {
    if (_ensureBotStateTablePromise) return _ensureBotStateTablePromise;
    _ensureBotStateTablePromise = pool.query(
        `CREATE TABLE IF NOT EXISTS ${BOT_STATE_TABLE} (
            key text PRIMARY KEY,
            value jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT NOW()
        )`
    ).then(() => true).catch(err => {
        _ensureBotStateTablePromise = null;
        throw err;
    });
    return _ensureBotStateTablePromise;
}

function normalizeLockState(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: Boolean(value.enabled),
        reason: value.reason ? String(value.reason) : null,
        changedBy: value.changedBy ? String(value.changedBy) : null,
        changedAt: value.changedAt ? String(value.changedAt) : null
    };
}

async function getBotStateValue(key) {
    await ensureBotStateTable();
    const normalizedKey = normalizeBotStateKey(key);
    const res = await pool.query(
        `SELECT value FROM ${BOT_STATE_TABLE} WHERE key = $1`,
        [normalizedKey]
    );
    return res.rows[0] ? res.rows[0].value : null;
}

async function setBotStateValue(key, value) {
    await ensureBotStateTable();
    const normalizedKey = normalizeBotStateKey(key);

    await pool.query(
        `INSERT INTO ${BOT_STATE_TABLE} (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [normalizedKey, JSON.stringify(value)]
    );

    return value;
}

async function getEventEpLock() {
    const value = await getBotStateValue(EVENT_EP_LOCK_KEY);
    if (!value) return normalizeLockState({ enabled: false });
    return normalizeLockState(value);
}

async function setEventEpLock(enabled, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const nextState = normalizeLockState({
        enabled: Boolean(enabled),
        reason: options.reason || null,
        changedBy: options.changedBy || null,
        changedAt: new Date().toISOString()
    });

    await setBotStateValue(EVENT_EP_LOCK_KEY, nextState);
    return nextState;
}

function createEventEpLockError(lockState) {
    const err = new Error('Event and EP updates are currently locked (read-only mode).');
    err.code = 'EVENT_EP_LOCKED';
    err.lockState = normalizeLockState(lockState);
    return err;
}

function isEventEpLockError(err) {
    return Boolean(err && err.code === 'EVENT_EP_LOCKED');
}

async function assertEventEpWriteUnlocked() {
    const lockState = await getEventEpLock();
    if (lockState.enabled) throw createEventEpLockError(lockState);
}

module.exports = {
    getBotStateValue,
    setBotStateValue,
    getEventEpLock,
    setEventEpLock,
    assertEventEpWriteUnlocked,
    createEventEpLockError,
    isEventEpLockError
};
