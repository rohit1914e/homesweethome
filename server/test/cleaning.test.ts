import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  anon,
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

beforeEach(async () => {
  closeSockets();
  await resetData();
  c = await loginAll();
  today = (await meta(c[1])).today;
});

const assign = (body: object, who = 1) => c[who].post('/api/cleaning/tasks', body);

describe('room cleaning — permissions', () => {
  it('only Rohit can assign; members get 403 and nothing is stored', async () => {
    for (const id of [2, 3, 4, 5, 6]) {
      expectError(await assign({ memberId: id, date: today, categories: ['floor'] }, id), 403, 'forbidden');
    }
    expect((await sql('SELECT count(*)::int AS n FROM cleaning_tasks'))[0].n).toBe(0);
    const r = await assign({ memberId: 2, date: today, categories: ['floor'] });
    expect(r.status).toBe(201);
  });

  it('the database itself rejects a duty authored by a non-admin', async () => {
    await expect(
      sql(`INSERT INTO cleaning_tasks (member_id, task_date, category, created_by) VALUES (2, $1, 'floor', 2)`, [today]),
    ).rejects.toThrow(/cleaning_author_not_admin/);
  });

  it('only Rohit can edit, reassign or delete', async () => {
    const t = (await assign({ memberId: 2, date: today, categories: ['dusting'] })).body.tasks[0];
    expectError(await c[2].patch(`/api/cleaning/tasks/${t.id}`, { memberId: 3 }), 403);
    expectError(await c[3].del(`/api/cleaning/tasks/${t.id}`), 403);
    const r = await c[1].patch(`/api/cleaning/tasks/${t.id}`, { memberId: 3, date: addDays(today, 2), instructions: 'Under the beds too' });
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({ memberId: 3, date: addDays(today, 2), instructions: 'Under the beds too' });
    expect((await c[1].del(`/api/cleaning/tasks/${t.id}`)).status).toBe(204);
    expectError(await c[1].del(`/api/cleaning/tasks/${t.id}`), 404);
  });

  it('members see only their own duties; Rohit sees everyone’s', async () => {
    await assign({ memberId: 2, date: today, categories: ['floor', 'mopping'] });
    await assign({ memberId: 4, date: addDays(today, 1), categories: ['bathroom'] });
    expect((await c[2].get('/api/cleaning/tasks')).body.tasks.map((t: any) => t.memberId)).toEqual([2, 2]);
    expect((await c[4].get('/api/cleaning/tasks')).body.tasks).toHaveLength(1);
    expect((await c[3].get('/api/cleaning/tasks')).body.tasks).toHaveLength(0);
    expect((await c[1].get('/api/cleaning/tasks')).body.tasks).toHaveLength(3);
    expectError(await anon().get('/api/cleaning/tasks'), 401);
  });

  it('a member completes only their own task; others get 403; Rohit can complete/reopen any', async () => {
    const t = (await assign({ memberId: 2, date: today, categories: ['sweeping'] })).body.tasks[0];
    expectError(await c[3].post(`/api/cleaning/tasks/${t.id}/complete`), 403);
    const done = await c[2].post(`/api/cleaning/tasks/${t.id}/complete`);
    expect(done.body.task.status).toBe('done');
    expect(done.body.task.completedAt).toBeTruthy();
    const reopened = await c[1].post(`/api/cleaning/tasks/${t.id}/reopen`);
    expect(reopened.body.task).toMatchObject({ status: 'pending', completedAt: null });
  });
});

describe('room cleaning — assigning', () => {
  it('multiple categories create one duty each, Rohit can assign himself, any date works', async () => {
    const r = await assign({ memberId: 1, date: addDays(today, 30), categories: ['floor', 'wall', 'bathroom', 'dusting', 'sweeping', 'mopping'] });
    expect(r.status).toBe(201);
    expect(r.body.tasks).toHaveLength(6);
    expect(new Set(r.body.tasks.map((t: any) => t.category)).size).toBe(6);
  });

  it('custom task requires a description; instructions are stored', async () => {
    expectError(await assign({ memberId: 5, date: today, categories: ['custom'] }), 422);
    const r = await assign({ memberId: 5, date: today, categories: ['custom'], customTitle: 'Clean the fridge', instructions: 'Throw out old curd' });
    expect(r.body.tasks[0]).toMatchObject({ category: 'custom', customTitle: 'Clean the fridge', instructions: 'Throw out old curd', status: 'pending' });
  });

  it('rejects invalid input', async () => {
    expectError(await assign({ memberId: 7, date: today, categories: ['floor'] }), 422);
    expectError(await assign({ memberId: 2, date: '20-11-2026', categories: ['floor'] }), 422);
    expectError(await assign({ memberId: 2, date: today, categories: [] }), 422);
    expectError(await assign({ memberId: 2, date: today, categories: ['laundry'] }), 422);
  });

  it('assignment notifies the assignee; completion notifies Rohit; tasks persist', async () => {
    const t = (await assign({ memberId: 6, date: today, categories: ['floor', 'mopping'] })).body.tasks[0];
    const n6 = (await c[6].get('/api/notifications')).body;
    expect(n6.notifications[0]).toMatchObject({ kind: 'cleaning_assigned', link: '/cleaning' });
    expect(n6.notifications[0].body).toContain('Floor cleaning');
    expect((await c[2].get('/api/notifications')).body.unread).toBe(0);
    await c[6].post(`/api/cleaning/tasks/${t.id}/complete`);
    const n1 = (await c[1].get('/api/notifications')).body.notifications;
    expect(n1.some((n: any) => n.kind === 'cleaning_completed' && n.title.includes('Dharun'))).toBe(true);
    const again = (await c[6].get('/api/cleaning/tasks')).body.tasks;
    expect(again.find((x: any) => x.id === t.id).status).toBe('done');
  });

  it('status changes are broadcast live to other members', async () => {
    const t = (await assign({ memberId: 2, date: today, categories: ['dusting'] })).body.tasks[0];
    const rohitSocket = await connectSocket(c[1]);
    const ev = waitForEvent(rohitSocket, 'cleaning:changed', 3000);
    await c[2].post(`/api/cleaning/tasks/${t.id}/complete`);
    expect(await ev).toMatchObject({ taskId: t.id, action: 'completed' });
  });
});

describe('cooking retention (2 days)', () => {
  it('purge removes menus + votes older than yesterday, keeps today and yesterday', async () => {
    const mk = async (d: string) =>
      (await sql(`INSERT INTO cooking_menus (menu_date, title, created_by) VALUES ($1, $2, 1) RETURNING id`, [d, `m ${d}`]))[0].id;
    const old = await mk(addDays(today, -2));
    const y = await mk(addDays(today, -1));
    const t = await mk(today);
    await sql(`INSERT INTO cooking_votes (menu_id, member_id, choice) VALUES ($1, 2, 'want'), ($2, 2, 'want')`, [old, y]);
    // Even before the purge runs, history never shows anything older than yesterday.
    const hist = (await c[2].get('/api/cooking/menus')).body.menus.map((m: any) => m.id);
    expect(hist).toEqual(expect.arrayContaining([y, t]));
    expect(hist).not.toContain(old);
    const [{ n }] = await sql('SELECT purge_old_cooking() AS n');
    expect(n).toBe(1);
    expect((await sql('SELECT id FROM cooking_menus ORDER BY id')).map((r) => r.id)).toEqual([y, t]);
    expect((await sql('SELECT menu_id FROM cooking_votes')).map((r) => r.menu_id)).toEqual([y]);
  });
});
