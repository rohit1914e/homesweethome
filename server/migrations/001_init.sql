-- HomeSweetHome — initial schema.
-- Applied by server/src/migrate.ts inside a transaction, guarded by an advisory lock.
-- The room's clock is Asia/Kolkata. Every "what day is it" question is answered by room_today().

-- ---------------------------------------------------------------------------
-- Room clock
-- ---------------------------------------------------------------------------
CREATE FUNCTION room_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Washing machine booking window: today plus the next 5 days (6 bookable dates).
CREATE FUNCTION booking_window_end() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT room_today() + 5 $$;

-- ---------------------------------------------------------------------------
-- Members: exactly the six roommates. No registration path exists.
-- id is constrained to 1..6 and slug to the six names, so a seventh row is impossible.
-- ---------------------------------------------------------------------------
CREATE TABLE members (
  id            smallint    PRIMARY KEY CHECK (id BETWEEN 1 AND 6),
  slug          text        NOT NULL UNIQUE
                            CHECK (slug IN ('rohit', 'jagan', 'bharath', 'surya', 'bazith', 'dharun')),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  is_admin      boolean     NOT NULL DEFAULT false,
  pin_hash      text,                                   -- optional bcrypt hash; NULL = tap-to-enter
  bio           text        NOT NULL DEFAULT '' CHECK (char_length(bio) <= 280),
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_only_rohit_is_admin CHECK (is_admin = (slug = 'rohit'))
);

-- ---------------------------------------------------------------------------
-- Sessions: opaque random token in an httpOnly cookie; only its SHA-256 is stored.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  token_hash    bytea       PRIMARY KEY,
  member_id     smallint    NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text
);
CREATE INDEX sessions_member_idx ON sessions (member_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Cooking
-- ---------------------------------------------------------------------------
CREATE TABLE cooking_menus (
  id           serial      PRIMARY KEY,
  menu_date    date        NOT NULL,
  title        text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  description  text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  image        bytea       CHECK (octet_length(image) <= 2097152),
  image_mime   text        CHECK (image_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  status       text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by   smallint    NOT NULL REFERENCES members(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  CONSTRAINT cooking_menus_image_pair CHECK ((image IS NULL) = (image_mime IS NULL)),
  CONSTRAINT cooking_menus_closed_pair CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX cooking_menus_date_idx ON cooking_menus (menu_date DESC, id DESC);

-- Only the administrator may author a menu (defence in depth behind the API check).
CREATE FUNCTION cooking_menus_author_is_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.created_by AND is_admin) THEN
    RAISE EXCEPTION 'menu_author_not_admin' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cooking_menus_author_is_admin
  BEFORE INSERT OR UPDATE OF created_by ON cooking_menus
  FOR EACH ROW EXECUTE FUNCTION cooking_menus_author_is_admin();

-- One vote per member per menu (primary key); changing a vote is an UPDATE of the same row.
CREATE TABLE cooking_votes (
  menu_id     integer     NOT NULL REFERENCES cooking_menus(id) ON DELETE CASCADE,
  member_id   smallint    NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  choice      text        NOT NULL CHECK (choice IN ('want', 'dont_want')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (menu_id, member_id)
);

-- Votes are rejected once the menu is closed. FOR SHARE serialises against a
-- concurrent "close voting" UPDATE, so no vote can slip in after the close commits.
CREATE FUNCTION cooking_votes_require_open_menu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM cooking_menus WHERE id = NEW.menu_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'menu_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF s <> 'open' THEN
    RAISE EXCEPTION 'voting_closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cooking_votes_require_open_menu
  BEFORE INSERT OR UPDATE ON cooking_votes
  FOR EACH ROW EXECUTE FUNCTION cooking_votes_require_open_menu();

-- ---------------------------------------------------------------------------
-- Washing machine (one machine, one active booking per date)
-- ---------------------------------------------------------------------------
CREATE TABLE washing_bookings (
  id            serial      PRIMARY KEY,
  booking_date  date        NOT NULL,
  member_id     smallint    NOT NULL REFERENCES members(id),   -- who uses the machine
  booked_by     smallint    NOT NULL REFERENCES members(id),   -- who made the booking (self, or Rohit)
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  cancelled_by  smallint    REFERENCES members(id),
  CONSTRAINT washing_bookings_cancel_pair CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL))
);
-- The database itself guarantees a date can only be actively booked once.
-- Concurrent inserts for the same date: exactly one commits, the rest get 23505.
CREATE UNIQUE INDEX washing_bookings_one_per_date
  ON washing_bookings (booking_date) WHERE cancelled_at IS NULL;
CREATE INDEX washing_bookings_date_idx ON washing_bookings (booking_date DESC, id DESC);

-- New bookings must fall inside the rolling window, judged by the room clock.
CREATE FUNCTION washing_bookings_in_window() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.booking_date < room_today() OR NEW.booking_date > booking_window_end() THEN
    RAISE EXCEPTION 'date_out_of_window' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER washing_bookings_in_window
  BEFORE INSERT ON washing_bookings
  FOR EACH ROW EXECUTE FUNCTION washing_bookings_in_window();

-- ---------------------------------------------------------------------------
-- Group chat
-- ---------------------------------------------------------------------------
CREATE TABLE chat_messages (
  id          bigserial   PRIMARY KEY,
  member_id   smallint    NOT NULL REFERENCES members(id),
  body        text        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  client_id   uuid,                                    -- lets a retried send stay idempotent
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_client_unique UNIQUE (member_id, client_id)
);
CREATE INDEX chat_messages_recent_idx ON chat_messages (id DESC);

CREATE TABLE chat_reads (
  member_id             smallint    PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  last_read_message_id  bigint      NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- In-app notifications
-- dedupe_key coalesces repeats into one unread row (count is bumped instead).
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id          bigserial   PRIMARY KEY,
  member_id   smallint    NOT NULL REFERENCES members(id) ON DELETE CASCADE,  -- recipient
  kind        text        NOT NULL CHECK (kind IN (
                'menu_published', 'menu_updated', 'menu_closed', 'vote_cast',
                'booking_created', 'booking_cancelled', 'chat_message')),
  title       text        NOT NULL,
  body        text        NOT NULL DEFAULT '',
  link        text        NOT NULL DEFAULT '/',
  actor_id    smallint    REFERENCES members(id),
  dedupe_key  text,
  count       integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE UNIQUE INDEX notifications_unread_dedupe
  ON notifications (member_id, dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL;
CREATE INDEX notifications_recipient_idx ON notifications (member_id, created_at DESC);
