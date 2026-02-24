'use strict';

const { pool } = require('../connection');
const { BOT_STATE_TABLE } = require('../constants');

const EVENT_EP_LOCK_KEY = 'event_ep_lock';

let _ensureBotStateTablePromise = null;

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

async function getEventEpLock() {
    await ensureBotStateTable();
    const res = await pool.query(
        `SELECT value FROM ${BOT_STATE_TABLE} WHERE key = $1`,
        [EVENT_EP_LOCK_KEY]
    );
    if (!res.rows[0]) return normalizeLockState({ enabled: false });
    return normalizeLockState(res.rows[0].value);
}

async function setEventEpLock(enabled, opts) {
    await ensureBotStateTable();
    const options = opts && typeof opts === 'object' ? opts : {};
    const nextState = normalizeLockState({
        enabled: Boolean(enabled),
        reason: options.reason || null,
        changedBy: options.changedBy || null,
        changedAt: new Date().toISOString()
    });

    await pool.query(
        `INSERT INTO ${BOT_STATE_TABLE} (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [EVENT_EP_LOCK_KEY, JSON.stringify(nextState)]
    );

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
    getEventEpLock,
    setEventEpLock,
    assertEventEpWriteUnlocked,
    createEventEpLockError,
    isEventEpLockError
};
