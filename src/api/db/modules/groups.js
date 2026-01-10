'use strict';

const { pool } = require('../connection');
const { toId, ensureTimestamp, normalizeGroupRoles } = require('../utils');
const { GROUPS_TABLE } = require('../constants');

/**
 * Get group details by ID
 * @param {string} groupId 
 * @returns {Promise<import('../types').Group|null>}
 */
async function getGroup(groupId) {
    const res = await pool.query(
        `SELECT groupid, roles, expires FROM ${GROUPS_TABLE} WHERE groupid = $1`,
        [toId(groupId)]
    );
    if (!res.rows[0]) return null;
    return {
        groupid: res.rows[0].groupid ? String(res.rows[0].groupid) : null,
        roles: normalizeGroupRoles(res.rows[0].roles),
        expires: ensureTimestamp(res.rows[0].expires)
    };
}

/**
 * Create a new group
 * @param {string} groupId 
 * @param {import('../types').GroupRole[]} roles 
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
 * Update a group
 * @param {string} groupId 
 * @param {Partial<import('../types').Group>} updates 
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
 * Delete a group
 * @param {string} groupId 
 * @returns {Promise<void>}
 */
async function deleteGroup(groupId) {
    await pool.query(
        `DELETE FROM ${GROUPS_TABLE} WHERE groupid = $1`,
        [toId(groupId)]
    );
}

/**
 * List all groups
 * @returns {Promise<import('../types').Group[]>}
 */
async function listGroups() {
    const res = await pool.query(`SELECT groupid, roles, expires FROM ${GROUPS_TABLE}`);
    return res.rows.map(row => ({
        groupid: row.groupid ? String(row.groupid) : null,
        roles: normalizeGroupRoles(row.roles),
        expires: ensureTimestamp(row.expires)
    }));
}

module.exports = {
    getGroup,
    createGroup,
    updateGroup,
    deleteGroup,
    listGroups
};
