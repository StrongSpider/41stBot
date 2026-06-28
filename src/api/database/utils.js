'use strict';

/**
 * Ensure a timestamp-like value returns an ISO string.
 * @param {number|string|Date} val
 * @returns {string}
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
 * Convert an ID to a BigInt for Prisma bigint columns.
 * @param {string|number|bigint} id
 * @returns {bigint}
 */
function toBigInt(id) {
    return BigInt(String(id));
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
 * @returns {Array}
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

function normalizeJsonArray(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function normalizeBadges(raw) {
    return normalizeJsonArray(raw);
}

function normalizeAssets(raw) {
    return normalizeJsonArray(raw);
}

/**
 * Normalize and sanity-check a candidate event_type string.
 * @param {unknown} value
 * @returns {string}
 */
function assertSafeEventType(value) {
    if (typeof value !== 'string') throw new Error('event_type must be a string');

    if (value.length === 0 || value.length > 64) throw new Error('invalid event_type length');
    if (!/^[\x20-\x7E]+$/.test(value)) throw new Error('invalid characters in event_type');
    if (!/^[A-Za-z0-9._\- ]+$/.test(value)) throw new Error('event_type contains disallowed characters');

    const badFragments = [
        '--', '/*', '*/', ';', '\\', '\'', '"', '`', '$$', '::', '%', '_'
    ];
    for (const frag of badFragments) {
        if (value.includes(frag)) throw new Error('possible SQL injection detected (meta-character)');
    }

    const keywordRx = /\b(select|union|insert|update|delete|drop|alter|create|grant|revoke|truncate|execute|exec|call|copy|do|or|and)\b/i;
    if (keywordRx.test(value)) throw new Error('possible SQL injection detected (keyword)');

    return value;
}

module.exports = {
    ensureTimestamp,
    toId,
    toBigInt,
    toNumOrNull,
    normalizeEventCaps,
    normalizeBadges,
    normalizeAssets,
    assertSafeEventType
};
