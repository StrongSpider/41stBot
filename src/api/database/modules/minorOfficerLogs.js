'use strict';

const { pool } = require('../connection');
const { toId } = require('../utils');
const {
    MINOR_OFFICER_LOGS_WEEKLY_TABLE,
    MINOR_OFFICER_LOGS_ALL_TIME_TABLE
} = require('../constants');
const { assertEventEpWriteUnlocked } = require('./botState');

let _ensureMinorOfficerTablesPromise = null;

/**
 * @param {string} tableName
 * @returns {Promise<void>}
 */
async function ensureReviewCountTable(tableName) {
    await pool.query(
        `CREATE TABLE IF NOT EXISTS ${tableName} (
            discordid text PRIMARY KEY,
            review_count integer NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT NOW()
        )`
    );

    await pool.query(
        `ALTER TABLE ${tableName}
         ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0`
    );
    await pool.query(
        `ALTER TABLE ${tableName}
         ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW()`
    );

    const columnsRes = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = $1`,
        [tableName]
    );
    const columnNames = new Set(columnsRes.rows.map((row) => String(row.column_name)));
    const hasApproved = columnNames.has('approved_count');
    const hasDenied = columnNames.has('denied_count');

    if (hasApproved || hasDenied) {
        const approvedExpr = hasApproved ? 'COALESCE(approved_count, 0)' : '0';
        const deniedExpr = hasDenied ? 'COALESCE(denied_count, 0)' : '0';
        await pool.query(
            `UPDATE ${tableName}
             SET review_count = CASE
                 WHEN review_count = 0 THEN ${approvedExpr} + ${deniedExpr}
                 ELSE review_count
             END`
        );
    }
}

/**
 * @returns {Promise<void>}
 */
async function ensureMinorOfficerReviewTables() {
    if (_ensureMinorOfficerTablesPromise) return _ensureMinorOfficerTablesPromise;

    _ensureMinorOfficerTablesPromise = (async () => {
        await ensureReviewCountTable(MINOR_OFFICER_LOGS_WEEKLY_TABLE);
        await ensureReviewCountTable(MINOR_OFFICER_LOGS_ALL_TIME_TABLE);
    })().catch((err) => {
        _ensureMinorOfficerTablesPromise = null;
        throw err;
    });

    return _ensureMinorOfficerTablesPromise;
}

/**
 * @param {string} tableName
 * @param {string} discordId
 * @returns {Promise<void>}
 */
async function incrementReviewCountByTable(tableName, discordId) {
    await pool.query(
        `INSERT INTO ${tableName} (discordid, review_count, updated_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT (discordid) DO UPDATE
         SET review_count = ${tableName}.review_count + 1,
             updated_at = NOW()`,
        [toId(discordId)]
    );
}

/**
 * Increment reviewer count (approve or deny both count as one review).
 * @param {string} reviewerDiscordId
 * @returns {Promise<void>}
 */
async function incrementMinorOfficerReviewerCount(reviewerDiscordId) {
    await assertEventEpWriteUnlocked();
    await ensureMinorOfficerReviewTables();

    const did = toId(reviewerDiscordId);
    await incrementReviewCountByTable(MINOR_OFFICER_LOGS_WEEKLY_TABLE, did);
    await incrementReviewCountByTable(MINOR_OFFICER_LOGS_ALL_TIME_TABLE, did);
}

/**
 * @param {string} tableName
 * @returns {Promise<Array<{discordId: string, count: number}>>}
 */
async function listReviewCountsByTable(tableName) {
    await ensureMinorOfficerReviewTables();
    const res = await pool.query(
        `SELECT discordid, review_count
         FROM ${tableName}`
    );

    return res.rows.map((row) => ({
        discordId: String(row.discordid),
        count: Number(row.review_count) || 0
    }));
}

/**
 * @returns {Promise<Array<{discordId: string, count: number}>>}
 */
async function getWeeklyMinorOfficerReviewCounts() {
    return listReviewCountsByTable(MINOR_OFFICER_LOGS_WEEKLY_TABLE);
}

/**
 * @returns {Promise<Array<{discordId: string, count: number}>>}
 */
async function getAllTimeMinorOfficerReviewCounts() {
    return listReviewCountsByTable(MINOR_OFFICER_LOGS_ALL_TIME_TABLE);
}

/**
 * @returns {Promise<void>}
 */
async function resetWeeklyMinorOfficerReviewCounts() {
    await assertEventEpWriteUnlocked();
    await ensureMinorOfficerReviewTables();
    await pool.query(`DELETE FROM ${MINOR_OFFICER_LOGS_WEEKLY_TABLE}`);
}

module.exports = {
    ensureMinorOfficerReviewTables,
    incrementMinorOfficerReviewerCount,
    getWeeklyMinorOfficerReviewCounts,
    getAllTimeMinorOfficerReviewCounts,
    resetWeeklyMinorOfficerReviewCounts
};
