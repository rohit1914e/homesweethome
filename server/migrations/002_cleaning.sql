-- Room cleaning duties (assigned by Rohit only) + 2-day cooking retention support.

CREATE TABLE cleaning_tasks (
  id            serial      PRIMARY KEY,
  member_id     smallint    NOT NULL REFERENCES members(id),        -- who does it
  task_date     date        NOT NULL,
  category      text        NOT NULL CHECK (category IN
                  ('floor', 'wall', 'bathroom', 'dusting', 'sweeping', 'mopping', 'custom')),
  custom_title  text        CHECK (char_length(btrim(custom_title)) BETWEEN 1 AND 120),
  instructions  text        NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 1000),
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  completed_at  timestamptz,
  created_by    smallint    NOT NULL REFERENCES members(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaning_custom_needs_title CHECK ((category = 'custom') = (custom_title IS NOT NULL)),
  CONSTRAINT cleaning_done_pair CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX cleaning_tasks_date_idx ON cleaning_tasks (task_date, id);
CREATE INDEX cleaning_tasks_member_idx ON cleaning_tasks (member_id, task_date);

-- Only the administrator may assign duties (defence in depth behind the API check).
CREATE FUNCTION cleaning_tasks_author_is_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.created_by AND is_admin) THEN
    RAISE EXCEPTION 'cleaning_author_not_admin' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cleaning_tasks_author_is_admin
  BEFORE INSERT OR UPDATE OF created_by ON cleaning_tasks
  FOR EACH ROW EXECUTE FUNCTION cleaning_tasks_author_is_admin();

-- New notification kinds.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'menu_published', 'menu_updated', 'menu_closed', 'vote_cast',
  'booking_created', 'booking_cancelled', 'chat_message',
  'cleaning_assigned', 'cleaning_completed'));

-- Cooking history is kept for 2 days (today + yesterday); older menus and their votes are purged.
CREATE FUNCTION purge_old_cooking() RETURNS integer LANGUAGE sql AS $$
  WITH d AS (DELETE FROM cooking_menus WHERE menu_date < room_today() - 1 RETURNING 1)
  SELECT count(*)::int FROM d
$$;
