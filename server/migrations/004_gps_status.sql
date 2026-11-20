-- Automatic Home / College status from the browser's GPS (opt-in per member).
-- Privacy: members' coordinates are NEVER stored — the server compares a reading against
-- the two places in memory and keeps only the resulting status + timestamp.

-- Statuses: home, college, away (outside both), unavailable (GPS denied / unavailable).
ALTER TABLE members DROP CONSTRAINT members_location_check;
ALTER TABLE members ADD CONSTRAINT members_location_check
  CHECK (location IN ('home', 'college', 'away', 'unavailable'));

ALTER TABLE members
  ADD COLUMN location_source text CHECK (location_source IN ('manual', 'gps')),
  ADD COLUMN gps_enabled boolean NOT NULL DEFAULT false;
UPDATE members SET location_source = 'manual' WHERE location IS NOT NULL;
ALTER TABLE members ADD CONSTRAINT members_location_source_pair
  CHECK ((location IS NULL) = (location_source IS NULL));

-- The two reference places, configured by Rohit only (coordinates never sent to other members).
CREATE TABLE places (
  kind        text             PRIMARY KEY CHECK (kind IN ('home', 'college')),
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m    integer          NOT NULL CHECK (radius_m BETWEEN 25 AND 10000),
  updated_by  smallint         REFERENCES members(id),
  updated_at  timestamptz      NOT NULL DEFAULT now()
);
