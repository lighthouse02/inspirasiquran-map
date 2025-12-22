-- Seed legacy (previously hardcoded) dashboard rows into `activities`.
-- This makes the new Mission+Location distribution table show those totals.
--
-- Recommended order:
--   1) Run telegram-bot/activities-upgrade.sql (adds mission/activity_type/count_number columns)
--   2) Run this file
--
-- Safe to re-run: it deletes prior seed rows by note tag.

BEGIN;

DELETE FROM activities
WHERE note = 'seed:legacy_dashboard_v1';

-- Baseline date is intentionally old so it does NOT show as "+N" in the last-30-days delta.
-- (Your live updates will show up as red +N automatically.)

INSERT INTO activities (
  title,
  note,
  activity_date,
  activity_type,
  mission,
  country,
  location,
  count,
  count_number,
  latitude,
  longitude,
  attachment_url,
  attachment_type,
  raw
)
VALUES
  ('Legacy total — Tanzania — Chaani, Shangani, Potoa, Kidoti', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Tanzania', 'Chaani, Shangani, Potoa, Kidoti', '8680', 8680, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Chad', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Chad', 'Chad', '5000', 5000, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Djibouti', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Djibouti', 'Djibouti', '4000', 4000, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Niger', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Niger', 'Niger', '4000', 4000, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Tanzania — Dar Es Salaam, Pulau Zanzibar', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Tanzania', 'Dar Es Salaam, Pulau Zanzibar', '3000', 3000, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Cameroon — Kousseri, Youndi', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Cameroon', 'Kousseri, Youndi', '2000', 2000, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Sarajevo, Bosnia — Masjid Ship, Masjid Jezero, Masjid Sedrenik', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Sarajevo, Bosnia', 'Masjid Ship, Masjid Jezero, Masjid Sedrenik', '1650', 1650, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Tanzania — Ilala, Temeke', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Tanzania', 'Ilala, Temeke', '1650', 1650, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Ethiopia — Adama, Odomia', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Ethiopia', 'Adama, Odomia', '1000', 1000, NULL, NULL, NULL, NULL, NULL),
  ('Legacy total — Ouagadougou, Burkina Faso — Madrasah Izharuddin, Kombissiri', 'seed:legacy_dashboard_v1', '2025-01-01T00:00:00Z', 'distribution', 'Legacy', 'Ouagadougou, Burkina Faso', 'Madrasah Izharuddin, Kombissiri', '8000', 8000, NULL, NULL, NULL, NULL, NULL);

COMMIT;
