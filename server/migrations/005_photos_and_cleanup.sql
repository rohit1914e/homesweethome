-- Uploaded profile pictures (Render free has no persistent disk, so they live in PostgreSQL)
-- and the 6-day maintenance cleanup log.

-- One row per member; replacing a picture overwrites it, so uploads can never pile up.
CREATE TABLE member_photos (
  member_id   smallint    PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  image       bytea       NOT NULL CHECK (octet_length(image) <= 524288),   -- processed WebP, ≤ 512 KB
  mime        text        NOT NULL CHECK (mime = 'image/webp'),
  updated_by  smallint    REFERENCES members(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Every cleanup run: what was deleted (counts) plus a JSON backup of exactly those rows.
CREATE TABLE maintenance_runs (
  id           serial      PRIMARY KEY,
  kind         text        NOT NULL DEFAULT 'cleanup' CHECK (kind = 'cleanup'),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text        NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  deleted      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  backup       jsonb,                       -- rows removed by this run (kept for the latest runs only)
  error        text
);
-- At most one run can be in progress, enforced by the database itself.
CREATE UNIQUE INDEX maintenance_one_running ON maintenance_runs (kind) WHERE status = 'running';
CREATE INDEX maintenance_runs_recent_idx ON maintenance_runs (started_at DESC);
