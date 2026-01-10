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
const BADGES_TABLE = 'badges';
const ASSETS_TABLE = 'assets';
const GROUPS_TABLE = 'groups';
const SUSPICIOUS_PLACES_TABLE = 'suspicious_places';
const OFFICER_LABELS_TABLE = 'officer_labels';

const EVENT_TYPES_CACHE_TTL_MS = 60_000;

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
    BADGES_TABLE,
    ASSETS_TABLE,
    GROUPS_TABLE,
    SUSPICIOUS_PLACES_TABLE,
    OFFICER_LABELS_TABLE,
    EVENT_TYPES_CACHE_TTL_MS
};
