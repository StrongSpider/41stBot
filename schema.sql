-- Run on PostgreSQL 13+.

BEGIN;

-- UUID generator used by createWeeklyEvent()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Event types (cached by the app)
CREATE TABLE IF NOT EXISTS event_types (
  type text PRIMARY KEY,
  -- mirror your assertSafeEventType checks
  CONSTRAINT event_types_type_check_len CHECK (char_length(type) > 0 AND char_length(type) <= 64),
  CONSTRAINT event_types_type_check_ascii CHECK (type ~ '^[\x20-\x7E]+$'),
  CONSTRAINT event_types_type_check_allowlist CHECK (type ~ '^[A-Za-z0-9._\- ]+$')
);

-- 2) Roblox <-> Discord mapping
-- App upserts ON CONFLICT (discordid)
CREATE TABLE IF NOT EXISTS roblox_ids (
  discordid text PRIMARY KEY,
  robloxid  bigint UNIQUE NOT NULL
);

-- 3) Inactivity table (keyed by Discord ID)
CREATE TABLE IF NOT EXISTS inactivity (
  discordid text PRIMARY KEY,
  -- store epoch milliseconds (Number in code)
  date      bigint NOT NULL,
  reason    text   NOT NULL
);

-- 4) Weekly events
CREATE TABLE IF NOT EXISTS weekly_events (
  eventid    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendees  bigint[] NOT NULL DEFAULT '{}',
  host       bigint   NOT NULL REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE RESTRICT,
  supervisor bigint   NOT NULL REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE RESTRICT,
  "timestamp" timestamptz NOT NULL,
  type       text, -- Flexible text value
  message    text
);

-- Unique lookup by message URL, if present
CREATE UNIQUE INDEX IF NOT EXISTS weekly_events_message_uq
  ON weekly_events ((message))
  WHERE message IS NOT NULL;

CREATE INDEX IF NOT EXISTS weekly_events_host_idx       ON weekly_events (host);
CREATE INDEX IF NOT EXISTS weekly_events_supervisor_idx ON weekly_events (supervisor);
CREATE INDEX IF NOT EXISTS weekly_events_timestamp_idx  ON weekly_events ("timestamp");
CREATE INDEX IF NOT EXISTS weekly_events_type_idx       ON weekly_events (type);

-- 5) All-time events (mirror of weekly)
CREATE TABLE IF NOT EXISTS all_time_events (
  eventid    uuid PRIMARY KEY,
  attendees  bigint[] NOT NULL DEFAULT '{}',
  host       bigint   NOT NULL REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE RESTRICT,
  supervisor bigint   NOT NULL REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE RESTRICT,
  "timestamp" timestamptz NOT NULL,
  type       text, -- Flexible text value
  message    text
);

CREATE UNIQUE INDEX IF NOT EXISTS all_time_events_message_uq
  ON all_time_events ((message))
  WHERE message IS NOT NULL;

CREATE INDEX IF NOT EXISTS all_time_events_host_idx       ON all_time_events (host);
CREATE INDEX IF NOT EXISTS all_time_events_supervisor_idx ON all_time_events (supervisor);
CREATE INDEX IF NOT EXISTS all_time_events_timestamp_idx  ON all_time_events ("timestamp");
CREATE INDEX IF NOT EXISTS all_time_events_type_idx       ON all_time_events (type);

-- 6) Weekly events index per user (array of event IDs)
CREATE TABLE IF NOT EXISTS weekly_events_index (
  robloxid bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  events   uuid[] NOT NULL DEFAULT '{}'
);

-- 7) All-time events index per user (array of event IDs)
CREATE TABLE IF NOT EXISTS all_time_events_index (
  robloxid bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  events   uuid[] NOT NULL DEFAULT '{}'
);

-- 8) Current event points
-- App upserts ON CONFLICT (robloxid) and increments
CREATE TABLE IF NOT EXISTS event_points (
  robloxid    bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  eventpoints integer NOT NULL DEFAULT 0
);

-- 9) All-time event points
CREATE TABLE IF NOT EXISTS all_time_event_points (
  robloxid    bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  eventpoints integer NOT NULL DEFAULT 0
);

-- 10) Role quotas
CREATE TABLE IF NOT EXISTS role_quotas (
  roleid     text PRIMARY KEY,
  quotaep    integer NOT NULL DEFAULT 0,
  eventcaps  jsonb   NOT NULL DEFAULT '[]'::jsonb, -- array of {alias,type,count}
  overwrites text    NOT NULL DEFAULT '',
  exclusive  text    NOT NULL DEFAULT '',
  purges     boolean NOT NULL DEFAULT false
);

-- 11) Badges (per-user badge data as JSONB)
CREATE TABLE IF NOT EXISTS badges (
  robloxid bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- 12) Assets (per-user asset data as JSONB)
CREATE TABLE IF NOT EXISTS assets (
  robloxid bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- 13) Groups (cached group information)
CREATE TABLE IF NOT EXISTS groups (
  groupid text PRIMARY KEY,
  roles jsonb NOT NULL,
  expires timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS groups_expires_idx ON groups (expires);

-- 14) Suspicious Places (flagged place IDs for background checks)
CREATE TABLE IF NOT EXISTS suspicious_places (
  placeid bigint PRIMARY KEY,
  reason text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT NOW(),
  added_by text
);
CREATE INDEX IF NOT EXISTS suspicious_places_added_at_idx ON suspicious_places (added_at);

-- 15) Officer Labels (AI training data)
CREATE TABLE IF NOT EXISTS officer_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_roblox_id bigint NOT NULL,
  officer_discord_id text NOT NULL,
  label text NOT NULL CHECK (label IN ('REAL', 'LIKELY_REAL', 'LIKELY_ALT', 'ALT')),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS officer_labels_target_idx ON officer_labels (target_roblox_id);
CREATE INDEX IF NOT EXISTS officer_labels_officer_idx ON officer_labels (officer_discord_id);
CREATE INDEX IF NOT EXISTS officer_labels_created_at_idx ON officer_labels (created_at);

-- 16) Roblox User Cache (Shared username cache)
CREATE TABLE IF NOT EXISTS roblox_user_cache (
  robloxid bigint PRIMARY KEY,
  username text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
-- No index needed specifically for updated_at unless we do bulk cleanup often, 
-- but might be good for 'getOutdatedUsers'
CREATE INDEX IF NOT EXISTS roblox_user_cache_updated_at_idx ON roblox_user_cache (updated_at);

COMMIT;