'use strict';

const { prisma } = require('../connection');

const EVENT_EP_LOCK_KEY = 'event_ep_lock';

function normalizeBotStateKey(key) {
    const normalizedKey = typeof key === 'string' ? key.trim() : '';
    if (!normalizedKey) {
        throw new TypeError('Bot state key must be a non-empty string.');
    }
    return normalizedKey;
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
    const normalizedKey = normalizeBotStateKey(key);
    const row = await prisma.botState.findUnique({
        where: { key: normalizedKey },
        select: { value: true }
    });
    return row ? row.value : null;
}

async function setBotStateValue(key, value) {
    const normalizedKey = normalizeBotStateKey(key);
    await prisma.botState.upsert({
        where: { key: normalizedKey },
        create: { key: normalizedKey, value },
        update: { value }
    });
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
