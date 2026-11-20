-- Home / College status: each member sets their own. NULL = not set yet.
ALTER TABLE members
  ADD COLUMN location text CHECK (location IN ('home', 'college')),
  ADD COLUMN location_updated_at timestamptz,
  ADD CONSTRAINT members_location_pair CHECK ((location IS NULL) = (location_updated_at IS NULL));
