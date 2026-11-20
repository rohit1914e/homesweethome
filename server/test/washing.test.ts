import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_IDS,
  addDays,
  closeSockets,
  connectSocket,
  expectError,
  loginAll,
  meta,
  resetData,
  setupFile,
  sql,
  teardownFile,
  waitForEvent,
  type Client,
} from './helpers.js';

beforeAll(setupFile);
afterAll(teardownFile);

let c: Record<number, Client>;
let today: string;
let windowEnd: string;

beforeEach(async () => {
  closeSockets();
  await resetData();
  c = await loginAll();
  const m = await meta(c[1]);
  today = m.today;
  windowEnd = m.bookingWindow.end;
});

const book = (who: number, date: string, memberId?: number) =>
  c[who].post('/api/washing/bookings', memberId === undefined ? { date } : { date, memberId });

async function activeBookings(who = 1) {
  const res = await c[who].get('/api/washing/bookings');
  expect(res.status).toBe(200);
  return res.body.bookings as any[];
}

describe('meta: the room clock', () => {
  it('GET /api/meta reports Asia/Kolkata and a 6-date window today … today+5 (matching the DB clock)', async () => {
    const m = await meta(c[2]);
    expect(m.timezone).toBe('Asia/Kolkata');
    const [row] = await sql(`SELECT room_today()::text AS today, booking_window_end()::text AS end`);
    expect(m.today).toBe(row.today);
    expect(m.bookingWindow).toEqual({ start: row.today, end: row.end, days: 6 });
    expect(m.bookingWindow.end).toBe(addDays(m.today, 5));
    expect(Number.isNaN(Date.parse(m.serverTime))).toBe(false);
  });
});

describe('booking window', () => {
  it('today → 201 (booked by and for the caller)', async () => {
    const res = await book(4, today);
    expect(res.status, res.text).toBe(201);
    expect(res.body.booking).toMatchObject({ date: today, memberId: 4, bookedBy: 4, cancelledAt: null, cancelledBy: null });
    expect((await activeBookings(2)).map((b) => b.date)).toContain(today);
  });

  it('today+5 (last date of the window) → 201', async () => {
    expect(windowEnd).toBe(addDays(today, 5));
    const res = await book(3, windowEnd);
    expect(res.status, res.text).toBe(201);
    expect(res.body.booking.date).toBe(windowEnd);
  });

  it('every date in the window is bookable', async () => {
    for (let i = 0; i <= 5; i++) {
      const res = await book(ALL_IDS[i], addDays(today, i));
      expect(res.status, `today+${i}: ${res.text}`).toBe(201);
    }
  });

  it('today+6 → 422 date_out_of_window', async () => {
    expectError(await book(4, addDays(today, 6)), 422, 'date_out_of_window');
    expectError(await book(4, addDays(today, 30)), 422, 'date_out_of_window');
    expect(await activeBookings()).toEqual([]);
  });

  it('yesterday (and Rohit booking the past) → 422 date_out_of_window', async () => {
    expectError(await book(4, addDays(today, -1)), 422, 'date_out_of_window');
    expectError(await book(1, addDays(today, -1), 2), 422, 'date_out_of_window');
    expect((await sql('SELECT count(*)::int AS n FROM washing_bookings'))[0].n).toBe(0);
  });

  it('malformed dates → 422', async () => {
    for (const date of ['tomorrow', '2026-13-01', '', '2026/11/20', 20261120]) {
      const res = await c[2].post('/api/washing/bookings', { date });
      expect(res.status, `${JSON.stringify(date)} → ${res.text}`).toBe(422);
    }
    expect((await sql('SELECT count(*)::int AS n FROM washing_bookings'))[0].n).toBe(0);
  });
});

describe('one booking per date', () => {
  it('a taken date → 409 date_taken naming the holder', async () => {
    expect((await book(4, addDays(today, 1))).status).toBe(201);
    const res = await book(2, addDays(today, 1));
    expectError(res, 409, 'date_taken');
    expect(res.body.error.message).toContain('Surya');
    // Rohit can't double-book it either
    expectError(await book(1, addDays(today, 1)), 409, 'date_taken');
    expectError(await book(1, addDays(today, 1), 5), 409, 'date_taken');
    expect((await activeBookings()).length).toBe(1);
  });

  it('SIMULTANEOUS: six members book the same date at once → exactly one 201, five 409', async () => {
    for (const offset of [2, 3, 4]) {
      const date = addDays(today, offset);
      const results = await Promise.all(ALL_IDS.map((id) => book(id, date)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses, results.map((r) => r.text).join('\n')).toEqual([201, 409, 409, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('date_taken');
      const winner = results.find((r) => r.status === 201)!.body.booking;
      const rows = await sql('SELECT member_id FROM washing_bookings WHERE booking_date = $1', [date]);
      expect(rows).toEqual([{ member_id: winner.memberId }]);
    }
  });
});

describe('booking on behalf of someone', () => {
  it('a non-admin passing another memberId → 403, and no booking is created', async () => {
    const date = addDays(today, 1);
    expectError(await book(2, date, 3), 403, 'forbidden');
    expectError(await book(5, date, 1), 403, 'forbidden');
    expect((await sql('SELECT count(*)::int AS n FROM washing_bookings'))[0].n).toBe(0);
  });

  it('Rohit books on behalf of Jagan → memberId 2, bookedBy 1', async () => {
    const res = await book(1, addDays(today, 2), 2);
    expect(res.status, res.text).toBe(201);
    expect(res.body.booking).toMatchObject({ memberId: 2, bookedBy: 1, date: addDays(today, 2) });
    const [row] = await sql('SELECT member_id, booked_by FROM washing_bookings');
    expect(row).toEqual({ member_id: 2, booked_by: 1 });
  });

  it('Rohit cannot book for a member that does not exist', async () => {
    const res = await book(1, addDays(today, 2), 7);
    expect([404, 422]).toContain(res.status);
    expect((await sql('SELECT count(*)::int AS n FROM washing_bookings'))[0].n).toBe(0);
  });
});

describe('cancelling', () => {
  it('cancel own → 204, the date becomes bookable again', async () => {
    const date = addDays(today, 1);
    const b = (await book(4, date)).body.booking;
    expect((await c[4].del(`/api/washing/bookings/${b.id}`)).status).toBe(204);
    expect((await activeBookings()).map((x) => x.id)).not.toContain(b.id);
    const again = await book(3, date);
    expect(again.status, again.text).toBe(201);
    expect(again.body.booking.memberId).toBe(3);
  });

  it('a non-admin cancelling someone else’s booking → 403 and it stays', async () => {
    const b = (await book(4, today)).body.booking;
    expectError(await c[2].del(`/api/washing/bookings/${b.id}`), 403, 'forbidden');
    expect((await activeBookings()).map((x) => x.id)).toContain(b.id);
  });

  it('Rohit cancels anyone’s booking → 204', async () => {
    const b = (await book(5, today)).body.booking;
    expect((await c[1].del(`/api/washing/bookings/${b.id}`)).status).toBe(204);
    const [row] = await sql('SELECT cancelled_at, cancelled_by FROM washing_bookings WHERE id = $1', [b.id]);
    expect(row.cancelled_at).not.toBeNull();
    expect(row.cancelled_by).toBe(1);
  });

  it('cancelling twice → 409 cannot_cancel; unknown id → 404', async () => {
    const b = (await book(6, today)).body.booking;
    expect((await c[6].del(`/api/washing/bookings/${b.id}`)).status).toBe(204);
    expectError(await c[6].del(`/api/washing/bookings/${b.id}`), 409, 'cannot_cancel');
    expectError(await c[6].del(`/api/washing/bookings/999999`), 404);
  });

  it('a past booking cannot be cancelled → 409 cannot_cancel', async () => {
    // seed a past booking directly (the window trigger blocks it through the API, by design)
    await sql('ALTER TABLE washing_bookings DISABLE TRIGGER washing_bookings_in_window');
    try {
      await sql(`INSERT INTO washing_bookings (booking_date, member_id, booked_by) VALUES ($1, 4, 4)`, [
        addDays(today, -2),
      ]);
    } finally {
      await sql('ALTER TABLE washing_bookings ENABLE TRIGGER washing_bookings_in_window');
    }
    const [row] = await sql('SELECT id FROM washing_bookings');
    expectError(await c[4].del(`/api/washing/bookings/${row.id}`), 409, 'cannot_cancel');
    expectError(await c[1].del(`/api/washing/bookings/${row.id}`), 409, 'cannot_cancel');
  });

  it('history keeps cancelled rows (newest booking date first); the active list does not', async () => {
    const b1 = (await book(2, today)).body.booking;
    const b2 = (await book(3, addDays(today, 1))).body.booking;
    await c[2].del(`/api/washing/bookings/${b1.id}`);
    const b3 = (await book(4, today)).body.booking;

    const active = await activeBookings();
    expect(active.map((b) => b.id).sort()).toEqual([b2.id, b3.id].sort());

    const res = await c[5].get('/api/washing/history');
    expect(res.status).toBe(200);
    const hist = res.body.bookings as any[];
    expect(hist.map((b) => b.id).sort()).toEqual([b1.id, b2.id, b3.id].sort());
    expect(hist[0].date).toBe(addDays(today, 1));
    const cancelled = hist.find((b) => b.id === b1.id);
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(cancelled.cancelledBy).toBe(2);
    expect(res.body).toHaveProperty('nextCursor');
  });

  it('GET /bookings honours from/to and rejects ranges over 62 days', async () => {
    await book(2, today);
    await book(3, addDays(today, 3));
    const res = await c[2].get(`/api/washing/bookings?from=${addDays(today, 1)}&to=${addDays(today, 5)}`);
    expect(res.status).toBe(200);
    expect(res.body.bookings.map((b: any) => b.date)).toEqual([addDays(today, 3)]);
    expectError(await c[2].get(`/api/washing/bookings?from=${today}&to=${addDays(today, 90)}`), 422);
  });
});

describe('real-time & notifications', () => {
  it('another member’s socket receives booking:changed on create and cancel', async () => {
    const bharath = await connectSocket(c[3]);
    const date = addDays(today, 2);
    const created = waitForEvent<any>(bharath, 'booking:changed', 2000, (p) => p.action === 'created');
    const b = (await book(4, date)).body.booking;
    expect(await created).toEqual({ bookingId: b.id, date, action: 'created' });

    const cancelled = waitForEvent<any>(bharath, 'booking:changed', 2000, (p) => p.action === 'cancelled');
    await c[4].del(`/api/washing/bookings/${b.id}`);
    expect(await cancelled).toEqual({ bookingId: b.id, date, action: 'cancelled' });
  });

  it('a booking notifies everyone except the person who made it', async () => {
    await book(4, today);
    const rows = await sql(`SELECT member_id FROM notifications WHERE kind = 'booking_created' ORDER BY member_id`);
    expect(rows.map((r) => r.member_id)).toEqual([1, 2, 3, 5, 6]);
  });

  it('a failed booking (taken date) sends no notification and no event', async () => {
    await book(4, today);
    // The successful booking notifies the other 5 asynchronously — wait for those before clearing.
    for (let i = 0; i < 50 && (await sql('SELECT count(*)::int AS n FROM notifications'))[0].n < 5; i++) await new Promise((r) => setTimeout(r, 20));
    await sql('DELETE FROM notifications');
    const jagan = await connectSocket(c[2]);
    const got: any[] = [];
    jagan.on('booking:changed', (p) => got.push(p));
    expectError(await book(5, today), 409, 'date_taken');
    await new Promise((r) => setTimeout(r, 500));
    expect(got).toEqual([]);
    expect((await sql('SELECT count(*)::int AS n FROM notifications'))[0].n).toBe(0);
  });
});
