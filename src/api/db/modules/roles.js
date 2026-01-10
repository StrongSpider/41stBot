'use strict';

const { pool } = require('../connection');
const { normalizeEventCaps } = require('../utils');
const { ROLE_QUOTAS_TABLE } = require('../constants');

// ===========================================
// Role Quotas
// ===========================================

/**
 * Set or update a role quota
 * @param {string} roleId Discord Role ID
 * @param {number} quotaEP 
 * @param {import('../types').EventCap[]} eventCaps 
 * @param {string} overwrites Comma separated role IDs
 * @param {string} exclusive Comma separated role IDs
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
       purges     = EXCLUDED.purges`,
        [roleId, Number(quotaEP), eventCapsJson, String(overwrites), String(exclusive), Boolean(purges)]
    );
}

/**
 * Get role quota by ID
 * @param {string} roleId 
 * @returns {Promise<import('../types').RoleQuota|null>}
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
        exclusive: String(res.rows[0].exclusive ?? ''),
        purges: Boolean(res.rows[0].purges)
    };
}

/**
 * List all role quotas
 * @returns {Promise<import('../types').RoleQuota[]>}
 */
async function listRoleQuotas() {
    const res = await pool.query(
        `SELECT roleid, quotaep, eventcaps, overwrites, exclusive, purges FROM ${ROLE_QUOTAS_TABLE}`
    );
    return res.rows.map(row => ({
        roleId: String(row.roleid),
        quotaEP: Number(row.quotaep),
        eventCaps: normalizeEventCaps(row.eventcaps),
        overwrites: String(row.overwrites ?? ''),
        exclusive: String(row.exclusive ?? ''),
        purges: Boolean(row.purges)
    }));
}

/**
 * Delete a role quota
 * @param {string} roleId 
 * @returns {Promise<void>}
 */
async function deleteRoleQuota(roleId) {
    await pool.query(
        `DELETE FROM ${ROLE_QUOTAS_TABLE} WHERE roleid = $1`,
        [roleId]
    );
}

module.exports = {
    setRoleQuota,
    getRoleQuota,
    listRoleQuotas,
    deleteRoleQuota
};
