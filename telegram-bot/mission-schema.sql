-- Mission categories (dynamic pick-list for the guided bot)
--
-- Run this once in Neon SQL Editor.
-- The bot will fall back to a built-in default list if this table doesn't exist.

CREATE TABLE IF NOT EXISTS mission_options (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  sort_order integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mission_options_active_sort_idx
  ON mission_options(active, sort_order NULLS LAST, name);

-- Seed your current missions (safe to run multiple times)
INSERT INTO mission_options(name, active, sort_order) VALUES
  ('Syria', true, 10),
  ('Quran', true, 20),
  ('Kurban', true, 30),
  ('Telaga', true, 40),
  ('Palestin', true, 50),
  ('Hot Meals', true, 60),
  ('Iftar', true, 70)
ON CONFLICT (name) DO UPDATE SET active = EXCLUDED.active;
