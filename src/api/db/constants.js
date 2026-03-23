'use strict';

const ALL_TIME_EVENT_POINTS_TABLE = 'all_time_event_points';
const ALL_TIME_EVENTS_INDEX_TABLE = 'all_time_events_index';
const WEEKLY_EVENTS_INDEX_TABLE = 'weekly_events_index';
const ALL_TIME_EVENTS_TABLE = 'all_time_events';
const WEEKLY_EVENTS_TABLE = 'weekly_events';
const EVENT_POINTS_TABLE = 'event_points';
const EVENT_TYPES_TABLE = 'event_types';
const ROLE_QUOTAS_TABLE = 'role_quotas';
const ROBLOX_IDS_TABLE = 'roblox_ids';
const INACTIVITY_TABLE = 'inactivity';
const BOT_STATE_TABLE = 'bot_state';
const MINOR_OFFICER_LOGS_WEEKLY_TABLE = 'minor_officer_logs_weekly';
const MINOR_OFFICER_LOGS_ALL_TIME_TABLE = 'minor_officer_logs_all_time';

const EVENT_TYPES_CACHE_TTL_MS = 60_000;
const EVENT_TYPE_USAGE_CACHE_TTL_MS = 60_000;

module.exports = {
    ALL_TIME_EVENT_POINTS_TABLE,
    ALL_TIME_EVENTS_INDEX_TABLE,
    WEEKLY_EVENTS_INDEX_TABLE,
    ALL_TIME_EVENTS_TABLE,
    WEEKLY_EVENTS_TABLE,
    EVENT_POINTS_TABLE,
    EVENT_TYPES_TABLE,
    ROLE_QUOTAS_TABLE,
    ROBLOX_IDS_TABLE,
    INACTIVITY_TABLE,
    BOT_STATE_TABLE,
    MINOR_OFFICER_LOGS_WEEKLY_TABLE,
    MINOR_OFFICER_LOGS_ALL_TIME_TABLE,
    EVENT_TYPES_CACHE_TTL_MS,
    EVENT_TYPE_USAGE_CACHE_TTL_MS
};
