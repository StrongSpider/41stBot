CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS event_types (
  type text PRIMARY KEY,
  CONSTRAINT event_types_type_check_len CHECK (
    char_length(type) > 0
    AND char_length(type) <= 64
  ),
  CONSTRAINT event_types_type_check_ascii CHECK (type ~ '^[\x20-\x7E]+$'),
  CONSTRAINT event_types_type_check_allowlist CHECK (type ~ '^[A-Za-z0-9._\- ]+$')
);

CREATE TABLE IF NOT EXISTS roblox_ids (
  discordid text PRIMARY KEY,
  robloxid bigint UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS inactivity (
  discordid text PRIMARY KEY,
  date bigint NOT NULL,
  reason text NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_events (
  eventid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendees bigint[] NOT NULL DEFAULT '{}',
  host bigint NOT NULL REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE RESTRICT,
  supervisor bigint NOT NULL REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE RESTRICT,
  "timestamp" timestamptz NOT NULL,
  type text,
  message text
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_events_message_uq ON weekly_events ((message))
WHERE message IS NOT NULL;
CREATE INDEX IF NOT EXISTS weekly_events_host_idx ON weekly_events (host);
CREATE INDEX IF NOT EXISTS weekly_events_supervisor_idx ON weekly_events (supervisor);
CREATE INDEX IF NOT EXISTS weekly_events_timestamp_idx ON weekly_events ("timestamp");
CREATE INDEX IF NOT EXISTS weekly_events_type_idx ON weekly_events (type);

CREATE TABLE IF NOT EXISTS all_time_events (
  eventid uuid PRIMARY KEY,
  attendees bigint[] NOT NULL DEFAULT '{}',
  host bigint NOT NULL REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE RESTRICT,
  supervisor bigint NOT NULL REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE RESTRICT,
  "timestamp" timestamptz NOT NULL,
  type text,
  message text
);

CREATE UNIQUE INDEX IF NOT EXISTS all_time_events_message_uq ON all_time_events ((message))
WHERE message IS NOT NULL;
CREATE INDEX IF NOT EXISTS all_time_events_host_idx ON all_time_events (host);
CREATE INDEX IF NOT EXISTS all_time_events_supervisor_idx ON all_time_events (supervisor);
CREATE INDEX IF NOT EXISTS all_time_events_timestamp_idx ON all_time_events ("timestamp");
CREATE INDEX IF NOT EXISTS all_time_events_type_idx ON all_time_events (type);

CREATE TABLE IF NOT EXISTS weekly_events_index (
  robloxid bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  events uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS all_time_events_index (
  robloxid bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  events uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS event_points (
  robloxid bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  eventpoints integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS all_time_event_points (
  robloxid bigint PRIMARY KEY REFERENCES roblox_ids(robloxid) ON UPDATE CASCADE ON DELETE CASCADE,
  eventpoints integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_quotas (
  roleid text PRIMARY KEY,
  quotaep integer NOT NULL DEFAULT 0,
  eventcaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  overwrites text DEFAULT '',
  exclusive text DEFAULT '',
  purges boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS roblox_user_cache (
  robloxid bigint PRIMARY KEY,
  username text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS roblox_user_cache_updated_at_idx ON roblox_user_cache (updated_at);

CREATE TABLE IF NOT EXISTS bot_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS minor_officer_logs_weekly (
  discordid text PRIMARY KEY,
  review_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE minor_officer_logs_weekly ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0;
ALTER TABLE minor_officer_logs_weekly ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'minor_officer_logs_weekly' AND column_name = 'approved_count'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'minor_officer_logs_weekly' AND column_name = 'denied_count'
  ) THEN
    EXECUTE 'UPDATE minor_officer_logs_weekly SET review_count = CASE WHEN review_count = 0 THEN '
      || CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'minor_officer_logs_weekly' AND column_name = 'approved_count'
      ) THEN 'COALESCE(approved_count, 0)' ELSE '0' END
      || ' + '
      || CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'minor_officer_logs_weekly' AND column_name = 'denied_count'
      ) THEN 'COALESCE(denied_count, 0)' ELSE '0' END
      || ' ELSE review_count END';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS minor_officer_logs_all_time (
  discordid text PRIMARY KEY,
  review_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE minor_officer_logs_all_time ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0;
ALTER TABLE minor_officer_logs_all_time ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'minor_officer_logs_all_time' AND column_name = 'approved_count'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'minor_officer_logs_all_time' AND column_name = 'denied_count'
  ) THEN
    EXECUTE 'UPDATE minor_officer_logs_all_time SET review_count = CASE WHEN review_count = 0 THEN '
      || CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'minor_officer_logs_all_time' AND column_name = 'approved_count'
      ) THEN 'COALESCE(approved_count, 0)' ELSE '0' END
      || ' + '
      || CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'minor_officer_logs_all_time' AND column_name = 'denied_count'
      ) THEN 'COALESCE(denied_count, 0)' ELSE '0' END
      || ' ELSE review_count END';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_badges (
  robloxid bigint PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS user_assets (
  robloxid bigint PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS officer_labels (
  id serial PRIMARY KEY,
  officer_discord_id text NOT NULL,
  target_roblox_id bigint NOT NULL,
  CONSTRAINT officer_labels_officer_discord_id_target_roblox_id_key UNIQUE (officer_discord_id, target_roblox_id)
);
CREATE INDEX IF NOT EXISTS officer_labels_target_roblox_id_idx ON officer_labels (target_roblox_id);
