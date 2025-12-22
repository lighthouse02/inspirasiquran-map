-- Daily Recap approval workflow (Neon Postgres)
--
-- Run this once in Neon SQL Editor.
--
-- Creates a table to store daily recap drafts that require approval.
-- The Railway Cron job inserts a PENDING recap.
-- The always-on Telegram bot handles Approve/Edit/Cancel and posts to channel.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS recap_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  mission text NOT NULL DEFAULT 'Syria',
  tz_offset_minutes integer NOT NULL DEFAULT 480,

  day_start_utc timestamptz NOT NULL,
  day_end_utc timestamptz NOT NULL,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','canceled')),

  draft_html text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Preview message (sent to approver chat)
  preview_chat_id text,
  preview_message_id bigint,

  -- Posted message (sent to channel)
  posted_chat_id text,
  posted_message_id bigint,
  posted_at timestamptz
);

CREATE INDEX IF NOT EXISTS recap_posts_status_created_at_idx
  ON recap_posts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS recap_posts_mission_day_idx
  ON recap_posts(mission, day_start_utc DESC);

-- Optional helper: keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recap_posts_set_updated_at ON recap_posts;
CREATE TRIGGER recap_posts_set_updated_at
BEFORE UPDATE ON recap_posts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
