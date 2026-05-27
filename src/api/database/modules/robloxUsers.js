'use strict';

const { pool } = require('../connection');
const { toId } = require('../utils');

const TABLE_NAME = 'roblox_user_cache';

/**
 * Get cached user by Roblox ID
 * @param {number|string} robloxId
 * @returns {Promise<{username: string, robloxId: number, updatedAt: Date}|null>}
 */
async function getUserById(robloxId) {
    const res = await pool.query(
        `SELECT robloxid, username, updated_at FROM ${TABLE_NAME} WHERE robloxid = $1`,
        [toId(robloxId)]
    );
    if (!res.rows.length) return null;
    return {
        robloxId: Number(res.rows[0].robloxid),
        username: res.rows[0].username,
        updatedAt: res.rows[0].updated_at
    };
}

/**
 * Get cached user by Username (case-insensitive search recommended, but here exact or whatever DB collation is)
 * @param {string} username
 * @returns {Promise<{username: string, robloxId: number, updatedAt: Date}|null>}
 */
async function getUserByUsername(username) {
    // Case insensitive matching usually preferred for usernames
    const res = await pool.query(
        `SELECT robloxid, username, updated_at FROM ${TABLE_NAME} WHERE LOWER(username) = LOWER($1)`,
        [username]
    );
    if (!res.rows.length) return null;
    return {
        robloxId: Number(res.rows[0].robloxid),
        username: res.rows[0].username,
        updatedAt: res.rows[0].updated_at
    };
}

/**
 * Upsert a user into the cache
 * @param {number|string} robloxId
 * @param {string} username
 * @returns {Promise<void>}
 */
async function upsertUser(robloxId, username) {
    await pool.query(
        `INSERT INTO ${TABLE_NAME} (robloxid, username, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (robloxid) DO UPDATE SET
            username = EXCLUDED.username,
            updated_at = EXCLUDED.updated_at`,
        [toId(robloxId), username]
    );
}

module.exports = {
    getUserById,
    getUserByUsername,
    upsertUser
};
