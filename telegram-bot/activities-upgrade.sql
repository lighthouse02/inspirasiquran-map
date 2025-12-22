-- Adds durable columns used for website aggregation / future SQL reporting.
-- Safe to run multiple times.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS mission text,
  ADD COLUMN IF NOT EXISTS activity_type text,
  ADD COLUMN IF NOT EXISTS count_number integer,
  ADD COLUMN IF NOT EXISTS country text;

-- Helpful indexes for filtering/grouping.
CREATE INDEX IF NOT EXISTS idx_activities_activity_type ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_mission_location ON activities(mission, location);
CREATE INDEX IF NOT EXISTS idx_activities_country ON activities(country);
CREATE INDEX IF NOT EXISTS idx_activities_activity_date ON activities(activity_date);
