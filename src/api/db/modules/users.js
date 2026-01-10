'use strict';

const { pool } = require('../connection');
const { toId, normalizeBadges, normalizeAssets } = require('../utils');
const {
    ROBLOX_IDS_TABLE,
    INACTIVITY_TABLE,
    BADGES_TABLE,
    ASSETS_TABLE,
    OFFICER_LABELS_TABLE
} = require('../constants');

// ===========================================
// Roblox ID Management
// ===========================================

/**
 * Get Roblox ID from Discord ID
 * @param {string} discordId 
 * @returns {Promise<number|null>} Roblox ID or null
 */

async function getRobloxIdByDiscord(discordId) {
    const res = await pool.query(
        `SELECT robloxid FROM ${ROBLOX_IDS_TABLE} WHERE discordid = $1`,
        [toId(discordId)]
    );
    return res.rows[0] ? Number(res.rows[0].robloxid) : null;
}

/**
 * Get Discord ID from Roblox ID
 * @param {number|string} robloxId 
 * @returns {Promise<string|null>} Discord ID or null
 */
async function getDiscordIdByRoblox(robloxId) {
    const res = await pool.query(
        `SELECT discordid FROM ${ROBLOX_IDS_TABLE} WHERE robloxid = $1`,
        [toId(robloxId)]
    );
    return res.rows[0] ? String(res.rows[0].discordid) : null;
}

/**
 * Link a Discord ID to a Roblox ID
 * @param {string} discordId 
 * @param {number|string} robloxId 
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
 * Delete a link by Discord ID
 * @param {string} discordId 
 * @returns {Promise<void>}
 */
async function deleteDiscordId(discordId) {
    await pool.query(
        `DELETE FROM ${ROBLOX_IDS_TABLE} WHERE discordid = $1`,
        [toId(discordId)]
    );
}

/**
 * Get all linked users
 * @returns {Promise<import('../types').User[]>}
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

/**
 * Batch get Discord IDs for multiple Roblox IDs
 * @param {string[]} robloxIds 
 * @returns {Promise<import('../types').User[]>}
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
 * Get a random Roblox ID from the database, optionally filtering out ones labeled by officer
 * @param {string} [officerDiscordId] Exclude users labeled by this officer
 * @returns {Promise<number|null>}
 */
async function getRandomUser(officerDiscordId) {
    // Use ASSETS_TABLE instead of ROBLOX_IDS_TABLE as per user request to target inventory database
    let query = `SELECT robloxid FROM ${ASSETS_TABLE}`;
    const params = [];

    if (officerDiscordId) {
        query += ` WHERE robloxid::numeric NOT IN (SELECT target_roblox_id FROM ${OFFICER_LABELS_TABLE} WHERE officer_discord_id = $1)`;
        params.push(String(officerDiscordId));
    }

    query += ` ORDER BY RANDOM() LIMIT 1`;

    const res = await pool.query(query, params);
    return res.rows[0] ? Number(res.rows[0].robloxid) : null;
}

// ===========================================
// Inactivity
// ===========================================

/**
 * Get inactivity notice for a user
 * @param {string} discordId 
 * @returns {Promise<import('../types').InactivityNotice|null>}
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
 * Get all inactivity notices
 * @returns {Promise<import('../types').InactivityNotice[]|null>}
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
 * Set or update inactivity notice
 * @param {string} discordId 
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
 * Delete inactivity notice
 * @param {string} discordId 
 * @returns {Promise<void>}
 */
async function deleteInactivity(discordId) {
    await pool.query(
        `DELETE FROM ${INACTIVITY_TABLE} WHERE discordid = $1`,
        [toId(discordId)]
    );
}

// ===========================================
// Badges
// ===========================================

/**
 * Get cached badges for user
 * @param {number|string} robloxId 
 * @returns {Promise<import('../types').BadgeData[]>}
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
 * Set cached badges for user (overwrites)
 * @param {number|string} robloxId 
 * @param {import('../types').BadgeData[]} badges 
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
 * Append badges to user cache
 * @param {number|string} robloxId 
 * @param {import('../types').BadgeData[]} badges 
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

/**
 * Get all cached badge data
 * @returns {Promise<{robloxId: number, badges: import('../types').BadgeData[]}[]>}
 */
async function getAllUserBadgesData() {
    const res = await pool.query(
        `SELECT robloxid, data FROM ${BADGES_TABLE}`
    );
    return res.rows.map(r => ({
        robloxId: Number(r.robloxid),
        badges: normalizeBadges(r.data)
    }));
}


// ===========================================
// Assets
// ===========================================

/**
 * Get cached assets for user
 * @param {number|string} robloxId 
 * @returns {Promise<import('../types').AssetData[]>}
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
 * Set cached assets for user (overwrite)
 * @param {number|string} robloxId 
 * @param {import('../types').AssetData[]} assets 
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
 * Append tokens to user cache
 * @param {number|string} robloxId 
 * @param {import('../types').AssetData[]} assets 
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

module.exports = {
    getRobloxIdByDiscord,
    getDiscordIdByRoblox,
    upsertRobloxId,
    deleteDiscordId,
    getAllUsers,
    getDiscordIdsBatch,
    getRandomUser,
    getInactivity,
    getAllInactivities,
    setInactivity,
    deleteInactivity,
    getUserBadges,
    setUserBadges,
    appendUserBadges,
    getAllUserBadgesData,
    getUserAssets,
    setUserAssets,
    appendUserAssets
};
