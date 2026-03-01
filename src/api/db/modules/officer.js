'use strict';

const { pool } = require('../connection');
const { toNumOrNull } = require('../utils');
const { SUSPICIOUS_PLACES_TABLE, OFFICER_LABELS_TABLE } = require('../constants');

let officerSnapshotColumnSupported = null;

async function supportsOfficerSnapshotColumn() {
    if (officerSnapshotColumnSupported !== null) {
        return officerSnapshotColumnSupported;
    }

    const res = await pool.query(
        `SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = $1
              AND column_name = 'features_snapshot'
        ) AS has_column`,
        [OFFICER_LABELS_TABLE]
    );

    officerSnapshotColumnSupported = !!res.rows[0]?.has_column;
    return officerSnapshotColumnSupported;
}

// ===========================================
// Suspicious Places
// ===========================================

/**
 * Get all suspicious places
 * @returns {Promise<import('../types').SuspiciousPlace[]>}
 */
async function getSuspiciousPlaces() {
    const res = await pool.query(
        `SELECT placeid, reason, added_at, added_by FROM ${SUSPICIOUS_PLACES_TABLE} ORDER BY added_at DESC`
    );
    return res.rows.map(row => ({
        placeId: Number(row.placeid),
        reason: String(row.reason),
        addedAt: row.added_at ? new Date(row.added_at).toISOString() : new Date().toISOString(),
        addedBy: row.added_by ? String(row.added_by) : null
    }));
}

/**
 * Add or update a suspicious place
 * @param {number|string} placeId 
 * @param {string} reason 
 * @param {string} [addedBy] Discord ID
 * @returns {Promise<void>}
 */
async function addSuspiciousPlace(placeId, reason, addedBy) {
    await pool.query(
        `INSERT INTO ${SUSPICIOUS_PLACES_TABLE} (placeid, reason, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (placeid) DO UPDATE SET reason = EXCLUDED.reason, added_by = EXCLUDED.added_by`,
        [Number(placeId), String(reason), addedBy ? String(addedBy) : null]
    );
}

/**
 * Remove a suspicious place
 * @param {number|string} placeId 
 * @returns {Promise<void>}
 */
async function removeSuspiciousPlace(placeId) {
    await pool.query(
        `DELETE FROM ${SUSPICIOUS_PLACES_TABLE} WHERE placeid = $1`,
        [Number(placeId)]
    );
}

/**
 * Check if a place is suspicious
 * @param {number|string} placeId 
 * @returns {Promise<{isSuspicious: boolean, reason: string|null}>}
 */
async function isSuspiciousPlace(placeId) {
    const res = await pool.query(
        `SELECT reason FROM ${SUSPICIOUS_PLACES_TABLE} WHERE placeid = $1`,
        [Number(placeId)]
    );
    if (!res.rows[0]) {
        return { isSuspicious: false, reason: null };
    }
    return {
        isSuspicious: true,
        reason: (res.rows[0].reason && res.rows[0].reason !== 'null') ? String(res.rows[0].reason) : null
    };
}

// ===========================================
// Officer Labels (AI Training Data)
// ===========================================

/**
 * Add an officer label
 * @param {string} targetRobloxId 
 * @param {string} officerDiscordId 
 * @param {string} label 
 * @param {Object|null} [featuresSnapshot]
 * @returns {Promise<number>} Label ID
 */
async function addOfficerLabel(targetRobloxId, officerDiscordId, label, featuresSnapshot = null) {
    const includeSnapshot = featuresSnapshot && await supportsOfficerSnapshotColumn();
    const query = includeSnapshot
        ? `INSERT INTO ${OFFICER_LABELS_TABLE} (target_roblox_id, officer_discord_id, label, features_snapshot)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id`
        : `INSERT INTO ${OFFICER_LABELS_TABLE} (target_roblox_id, officer_discord_id, label)
           VALUES ($1, $2, $3)
           RETURNING id`;

    const params = includeSnapshot
        ? [toNumOrNull(targetRobloxId), String(officerDiscordId), label, JSON.stringify(featuresSnapshot)]
        : [toNumOrNull(targetRobloxId), String(officerDiscordId), label];

    const res = await pool.query(query, params);
    return res.rows[0].id;
}

/**
 * Get officer labels
 * @param {string} [targetRobloxId] Optional filter
 * @returns {Promise<import('../types').OfficerLabel[]>}
 */
async function getOfficerLabels(targetRobloxId) {
    let query = `SELECT * FROM ${OFFICER_LABELS_TABLE}`;
    let params = [];

    if (targetRobloxId) {
        query += ` WHERE target_roblox_id = $1`;
        params.push(Number(targetRobloxId));
    }

    query += ` ORDER BY created_at DESC`;

    const res = await pool.query(query, params);
    return res.rows.map(r => ({
        id: r.id,
        targetRobloxId: Number(r.target_roblox_id),
        officerDiscordId: String(r.officer_discord_id),
        label: r.label,
        featuresSnapshot: r.features_snapshot || null,
        createdAt: r.created_at
    }));
}

module.exports = {
    getSuspiciousPlaces,
    addSuspiciousPlace,
    removeSuspiciousPlace,
    isSuspiciousPlace,
    addOfficerLabel,
    getOfficerLabels
};
