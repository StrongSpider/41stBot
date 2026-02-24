'use strict';

const { pool } = require('../connection');
const {
    WEEKLY_EVENTS_TABLE,
    WEEKLY_EVENTS_INDEX_TABLE,
    EVENT_POINTS_TABLE
} = require('../constants');
const { listWeeklyEvents, listAllTimeEvents, _eventDataWithUsernames } = require('./events');
const { assertEventEpWriteUnlocked } = require('./botState');

/**
 * Clear all weekly events from DB
 * @returns {Promise<void>}
 */
async function clearAllWeeklyEvents() {
    await assertEventEpWriteUnlocked();
    await pool.query(`DELETE FROM ${WEEKLY_EVENTS_TABLE}`);
    await pool.query(`DELETE FROM ${WEEKLY_EVENTS_INDEX_TABLE}`);
}

module.exports = {
    clearAllWeeklyEvents
};
