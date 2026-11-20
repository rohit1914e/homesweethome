// One washing machine, one active booking per date, bookable from room today to today+5.
// The window is judged by SQL (room_today()) here AND by the DB trigger; the partial unique
// index washing_bookings_one_per_date makes double-booking impossible under concurrency.
import { Router, type Request } from 'express';
import type { Booking } from '../../../shared/types.js';
import { requireAuth } from '../auth.js';
import { isUniqueViolation, query, raisedCode, withTx } from '../db.js';
import { conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { MEMBER_IDS } from '../members.js';
import { notify } from '../notify.js';
import { broadcast } from '../realtime.js';
import { roomClock } from '../time.js';
import { idParam, isoDate, parse, z } from '../validate.js';

const router = Router();
router.use(requireAuth);

const realDate = isoDate.refine((d) => {
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}, 'That date does not exist.');

const rangeSchema = z.object({ from: realDate.optional(), to: realDate.optional() });
const historySchema = z.object({
  before: idParam.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const createSchema = z.object({
  date: realDate,
  memberId: z
    .number()
    .int()
    .refine((id) => MEMBER_IDS.includes(id), 'Pick one of the six roommates.')
    .optional(),
});

interface BookingRow {
  id: number;
  booking_date: string;
  member_id: number;
  booked_by: number;
  created_at: Date;
  cancelled_at: Date | null;
  cancelled_by: number | null;
}

const COLS = 'id, booking_date, member_id, booked_by, created_at, cancelled_at, cancelled_by';

function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    date: r.booking_date,
    memberId: r.member_id,
    bookedBy: r.booked_by,
    createdAt: r.created_at.toISOString(),
    cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
    cancelledBy: r.cancelled_by,
  };
}

/** 'YYYY-MM-DD' → "Tue 24 Nov" */
function shortDay(d: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .formatToParts(new Date(`${d}T12:00:00Z`));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

const actor = (req: Request) => req.member!;

function changed(bookingId: number, date: string, action: 'created' | 'cancelled'): void {
  try {
    broadcast('booking:changed', { bookingId, date, action });
  } catch (err) {
    console.error('[washing] broadcast failed:', (err as Error).message);
  }
}

async function memberName(id: number): Promise<string> {
  const { rows } = await query<{ name: string }>('SELECT name FROM members WHERE id = $1', [id]);
  return rows[0]?.name ?? 'Someone';
}

function windowError(date: string, today: string, windowEnd: string) {
  const range = `You can book from today up to ${shortDay(windowEnd)}.`;
  return unprocessable(
    'date_out_of_window',
    date < today ? `${shortDay(date)} has already passed. ${range}` : `${shortDay(date)} is too far ahead. ${range}`,
  );
}

// ---------------------------------------------------------------------------
router.get('/bookings', async (req, res) => {
  const { from, to } = parse(rangeSchema, req.query);
  const r = await query<{ from: string; to: string; span: number }>(
    `SELECT f AS from, t AS to, (t - f) AS span
       FROM (SELECT COALESCE($1::date, room_today() - 7) AS f,
                    COALESCE($2::date, booking_window_end()) AS t) x`,
    [from ?? null, to ?? null],
  );
  const range = r.rows[0];
  if (range.span < 0) throw unprocessable('validation_failed', '"from" must be on or before "to".');
  if (range.span > 62) throw unprocessable('validation_failed', 'Ask for at most 62 days at a time.');
  const { rows } = await query<BookingRow>(
    `SELECT ${COLS} FROM washing_bookings
      WHERE cancelled_at IS NULL AND booking_date BETWEEN $1::date AND $2::date
      ORDER BY booking_date, id`,
    [range.from, range.to],
  );
  res.json({ bookings: rows.map(toBooking) });
});

router.get('/history', async (req, res) => {
  const { before, limit } = parse(historySchema, req.query);
  // Keyset on (booking_date DESC, id DESC); bookings are never hard-deleted, so the cursor row exists.
  const { rows } =
    before === undefined
      ? await query<BookingRow>(
          `SELECT ${COLS} FROM washing_bookings ORDER BY booking_date DESC, id DESC LIMIT $1`,
          [limit + 1],
        )
      : await query<BookingRow>(
          `SELECT ${COLS} FROM washing_bookings
            WHERE (booking_date, id) < (SELECT booking_date, id FROM washing_bookings WHERE id = $1)
            ORDER BY booking_date DESC, id DESC LIMIT $2`,
          [before, limit + 1],
        );
  const page = rows.slice(0, limit);
  res.json({
    bookings: page.map(toBooking),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  });
});

router.post('/bookings', async (req, res) => {
  const { date, memberId } = parse(createSchema, req.body);
  const me = actor(req);
  if (memberId !== undefined && memberId !== me.id && !me.isAdmin) {
    throw forbidden('You can only book the machine for yourself.');
  }
  const forId = memberId ?? me.id;

  const clock = await roomClock();
  if (date < clock.today || date > clock.windowEnd) throw windowError(date, clock.today, clock.windowEnd);

  let booking: Booking;
  try {
    const { rows } = await query<BookingRow>(
      `INSERT INTO washing_bookings (booking_date, member_id, booked_by) VALUES ($1, $2, $3) RETURNING ${COLS}`,
      [date, forId, me.id],
    );
    booking = toBooking(rows[0]);
  } catch (err) {
    if (isUniqueViolation(err, 'washing_bookings_one_per_date')) {
      const { rows } = await query<{ member_id: number; name: string }>(
        `SELECT b.member_id, m.name FROM washing_bookings b JOIN members m ON m.id = b.member_id
          WHERE b.booking_date = $1 AND b.cancelled_at IS NULL`,
        [date],
      );
      const holder = rows[0];
      const who = !holder ? 'Someone' : holder.member_id === me.id ? 'You' : holder.name;
      throw conflict('date_taken', `${who} already booked ${shortDay(date)}.`);
    }
    if (raisedCode(err) === 'date_out_of_window') {
      // The day rolled over between our check and the insert.
      const now = await roomClock();
      throw windowError(date, now.today, now.windowEnd);
    }
    throw err;
  }

  changed(booking.id, booking.date, 'created');
  const forName = forId === me.id ? me.name : await memberName(forId);
  void notify({
    recipients: 'everyone-except-actor',
    actorId: me.id,
    kind: 'booking_created',
    title:
      forId === me.id
        ? `${me.name} booked the washing machine for ${shortDay(date)}`
        : `${me.name} booked ${shortDay(date)} for ${forName}`,
    body: `The machine is taken on ${shortDay(date)}.`,
    link: '/washing',
  });
  res.status(201).json({ booking });
});

router.delete('/bookings/:id', async (req, res) => {
  const id = parse(idParam, req.params.id);
  const me = actor(req);
  const booking = await withTx(async (db) => {
    const { rows } = await query<BookingRow & { is_past: boolean }>(
      `SELECT ${COLS}, (booking_date < room_today()) AS is_past FROM washing_bookings WHERE id = $1 FOR UPDATE`,
      [id],
      db,
    );
    const row = rows[0];
    if (!row) throw notFound('That booking no longer exists.');
    if (row.member_id !== me.id && !me.isAdmin) throw forbidden('You can only cancel your own booking.');
    if (row.cancelled_at) throw conflict('cannot_cancel', `The booking for ${shortDay(row.booking_date)} is already cancelled.`);
    if (row.is_past) throw conflict('cannot_cancel', `${shortDay(row.booking_date)} has passed, so that booking can’t be cancelled.`);
    const upd = await query<BookingRow>(
      `UPDATE washing_bookings SET cancelled_at = now(), cancelled_by = $2 WHERE id = $1 RETURNING ${COLS}`,
      [id, me.id],
      db,
    );
    return toBooking(upd.rows[0]);
  });

  changed(booking.id, booking.date, 'cancelled');
  const forName = booking.memberId === me.id ? null : await memberName(booking.memberId);
  void notify({
    recipients: 'everyone-except-actor',
    actorId: me.id,
    kind: 'booking_cancelled',
    title: `${shortDay(booking.date)} is free for the washing machine`,
    body: forName ? `${me.name} cancelled ${forName}’s booking.` : `${me.name} cancelled their booking.`,
    link: '/washing',
  });
  res.status(204).end();
});

export default router;
