# HomeSweetHome — build contract (shared by all agents)

Private web app for exactly six roommates: **Rohit** (sole administrator — always displayed simply as "Rohit", never "Admin"), Jagan, Bharath, Surya, Bazith, Dharun. Cooking menu voting, one shared washing machine booking calendar, real-time group chat, members page, notifications.

Hosting target: **Render FREE tier only** (free web service that sleeps after 15 min idle; free Postgres that expires 30 days after creation). One Node process serves the API, Socket.IO and the built React app on `process.env.PORT`, host `0.0.0.0`.

## Stack (installed — do NOT run npm install; ask the lead if you need a package)
- Server: Node 20+/24, TypeScript (ESM, `NodeNext` — relative imports end in `.js`), Express 5, Socket.IO 4, `pg`, zod **v4**, bcryptjs, helmet, express-rate-limit, cookie-parser, compression.
- Client: React 19, Vite 6, Tailwind CSS v4 (tokens in `client/src/styles.css`), React Router 7, TanStack Query 5, lucide-react icons, sonner toasts, `@fontsource-variable/bricolage-grotesque`.
- Tests: vitest 5, supertest, socket.io-client, @playwright/test.
- Local Postgres: `npm run db:local` → `postgres://postgres@localhost:55432/homesweethome` (dev) and `.../homesweethome_test` (tests). Trust auth, no password.

## Already written by the lead (read, use, do not rewrite without asking)
| File | Purpose |
|---|---|
| `server/migrations/001_init.sql` | Full schema, constraints, triggers. **Verified** against PG 17. New schema changes go in `002_*.sql` etc. — tell the lead. |
| `shared/types.ts` | All API/socket payload types. Server imports with `import type ... from '../../shared/types.js'` (path relative to file). Client imports `@shared/types`. |
| `server/src/config.ts` | env config (`config.port`, `config.host`, `config.databaseUrl`, `config.cookieName`, `config.migrationsDir`, `config.clientDist`, `config.avatarsDir`, ...). |
| `server/src/db.ts` | `pool`, `query(text, params, db?)`, `withTx(fn)`, `isUniqueViolation(err, constraint?)`, `raisedCode(err)` (returns trigger codes like `'voting_closed'`, `'date_out_of_window'`, `'menu_not_found'`, `'menu_author_not_admin'`). DATE columns arrive as `'YYYY-MM-DD'` strings. |
| `server/src/errors.ts` | `HttpError(status, code, message)` + `badRequest/unauthorized/forbidden/notFound/conflict/unprocessable`. Throw them; Express 5 forwards async errors. |
| `server/src/validate.ts` | `parse(schema, data)` → 422 `validation_failed`; `isoDate`, `idParam`, `z`. |
| `server/src/time.ts` | `roomClock(db?)` → `{ today, windowEnd, serverTime }` from SQL `room_today()`. Room TZ = Asia/Kolkata. **Never compute "today" in JS on the server.** |
| `server/src/members.ts` | The six members (ids 1–6, Rohit = id 1 = only admin). |
| `server/src/types/express.d.ts` | `req.member: { id, slug, name, isAdmin }` set by `requireAuth`. |
| `client/src/lib/api.ts` | `api.get/post/put/patch/del`, `ApiError {status, code, message}`, `errorMessage(err)`. Adds `X-HSH-Client: 1` on mutations. |
| `client/src/lib/socket.ts` | `getSocket()`, `connectSocket()`, `disconnectSocket()`, `useSocketEvent(event, handler)`. |
| `client/src/lib/queries.ts` | `queryClient`, query keys `qk.*`, `useMe()`, `useMembers()` (`{members, byId}`), `useMeta()`. |
| `client/src/lib/time.ts` | `formatDay`, `formatTime`, `formatDateTime`, `addDays`, `dateFromISO`, `roomDateOf` — all in room TZ. |
| `client/src/components/ui.tsx` | `Button({variant,size,loading,icon})`, `Card`, `Spinner`, `EmptyState({icon,title,description,action})`, `PageHeader({title,description,actions})`, `Dialog`, `ConfirmDialog({open,title,description,confirmLabel,tone,loading,onConfirm,onCancel})`. |
| `client/src/components/Avatar.tsx` | `Avatar({member, size:'xs'|'sm'|'md'|'lg'|'xl', ring:'want'|'dont_want'|'pending'|'none', online?})`. Initials fallback when no photo. |

## Security rules (non-negotiable)
1. **Identity comes only from the session.** Routes use `req.member!.id`. Never accept a sender/voter/booker id from the body (only exception: Rohit may pass `memberId` to book *on behalf of* a member — server checks `req.member.isAdmin`).
2. Admin checks are server-side (`requireAdmin`), and the DB has triggers as a second line.
3. Login = tap your photo (no PIN by default — the owner's explicit choice). A member MAY set an optional 4–8 digit PIN in Settings; if `pin_hash` is set, login requires it (bcrypt compare, rate-limited). Rohit can clear anyone's PIN.
4. Session: random 32-byte token in an `httpOnly`, `SameSite=Lax`, `Secure` (prod) cookie `hsh_session`; DB stores only `sha256(token)`; 30-day sliding expiry.
5. CSRF: every non-GET `/api` request must carry header `X-HSH-Client: 1` (else 403 `csrf`). No CORS (same origin only).
6. Never log or return secrets. No secrets in client code. No `.env` committed.
7. All input validated with zod. Body limit 3 MB (food image data URLs).
8. Error body is always `{ "error": { "code": string, "message": string } }`. Messages are written for the roommates, plain and specific (e.g. "Jagan already booked Tue 24 Nov.").

## HTTP API (all JSON, prefix `/api`, all require a session unless marked public)
### Auth & meta — owner: **backend**
- `GET /api/health` (public) → `{ ok: true, db: true }` (Render health check; must not require auth).
- `GET /api/auth/members` (public) → `{ members: PublicMember[] }` (login screen; ordered by id).
- `POST /api/auth/login` (public) `{ memberId: number, pin?: string }` → 200 `{ member: Member }` + Set-Cookie. Errors: 401 `pin_required` (member has a PIN, none sent), 401 `invalid_pin`, 404 `not_found` (unknown member), 429 `rate_limited`.
- `POST /api/auth/logout` → 204, clears cookie + deletes session row.
- `GET /api/auth/me` → `{ member: Member }` or 401.
- `GET /api/meta` → `Meta` (`today`, `timezone`, `serverTime`, `bookingWindow {start,end,days:6}`).
- `GET /api/members` → `{ members: Member[] }` (with live `online` from presence).
- `PATCH /api/members/me` `{ bio }` → `{ member }`.
- `PUT /api/members/me/pin` `{ currentPin?: string, newPin: string | null }` → 204 (`null` removes; `currentPin` required if one is set; 401 `invalid_pin`).
- Admin (Rohit only, else 403 `forbidden`):
  - `DELETE /api/admin/members/:id/pin` → 204 (reset PIN).
  - `POST /api/admin/members/:id/sign-out` → 204 (delete all that member's sessions, emit `session:revoked` to them).
  - `GET /api/admin/backup` → JSON download (`Content-Disposition: attachment; filename=homesweethome-backup-YYYY-MM-DD.json`), format below.
  - `POST /api/admin/restore` `{ backup }` → `{ restored: Record<table, number> }`.
- Notifications: `GET /api/notifications` → `{ notifications: AppNotification[], unread: number }` (latest 30); `POST /api/notifications/read` `{ ids?: number[] }` (omit = all) → 204.

### Cooking — owner: **features**
- `GET /api/cooking/today` → `{ menus: Menu[] }` (menu_date = room today, newest first).
- `GET /api/cooking/menus?before=<id>&limit=<1..50, default 20>` → `{ menus: Menu[], nextCursor: number | null }` — history, all dates, newest first.
- `GET /api/cooking/menus/:id` → `{ menu: Menu }`.
- `GET /api/cooking/menus/:id/image` → image bytes with correct Content-Type, `Cache-Control: private, max-age=86400`; `imageUrl` = `/api/cooking/menus/:id/image?v=<updatedAt epoch>`.
- Admin: `POST /api/cooking/menus` `MenuInput` → 201 `{ menu }`; `PATCH /api/cooking/menus/:id` partial `MenuInput` → `{ menu }`; `DELETE /api/cooking/menus/:id` → 204; `POST /api/cooking/menus/:id/close` → `{ menu }`; `POST /api/cooking/menus/:id/reopen` → `{ menu }`.
- Everyone: `PUT /api/cooking/menus/:id/vote` `{ choice: 'want'|'dont_want' }` → `{ menu }`. 409 `voting_closed`, 404 `not_found`. Upsert on (menu_id, member_id) — one vote per member, changeable while open.
- Image: data URL, mime jpeg/png/webp verified by **magic bytes**, ≤ 2 MB decoded (422 `image_invalid` / `image_too_large`). Client downsizes to ≤1280px JPEG before upload.
- Menu.tally.pending = 6 − want − dontWant. `myVote` from req.member.

### Washing machine — owner: **features**
- Window: **6 bookable dates = room today … today+5** (`room_today()` … `booking_window_end()`). Past dates and dates after the window are not bookable.
- `GET /api/washing/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ bookings: Booking[] }` (active only, i.e. cancelled_at IS NULL; range ≤ 62 days; defaults to today−7 … windowEnd).
- `GET /api/washing/history?before=<id>&limit=<1..50>` → `{ bookings: Booking[], nextCursor }` (all bookings incl. cancelled, newest booking_date first).
- `POST /api/washing/bookings` `{ date, memberId? }` → 201 `{ booking }`. `memberId` only honoured for Rohit. Server validates window via SQL **and** the DB trigger/unique index enforce it. Errors: 409 `date_taken` ("<Name> already booked <day>."), 422 `date_out_of_window`.
- `DELETE /api/washing/bookings/:id` → 204. Allowed for the booking's member or Rohit; only for active bookings with date ≥ today (else 409 `cannot_cancel`). Sets cancelled_at/cancelled_by (soft cancel → history kept).
- Concurrency: rely on the partial unique index `washing_bookings_one_per_date`; map 23505 → 409 `date_taken`. Two simultaneous requests → exactly one 201.

### Chat — owner: **chat**
- `GET /api/chat/messages?before=<id>&limit=<1..100, default 50>` → `{ messages: ChatMessage[] (ascending by id), hasMore: boolean }`.
- `POST /api/chat/messages` `{ body: string (1..2000 after trim), clientId: uuid }` → 201 `{ message }`; idempotent on (member_id, client_id) — a retry returns the existing message with 200. Sender = req.member.id ONLY. Rate limit ~20 msgs / 10 s per member.
- `POST /api/chat/read` `{ lastMessageId }` → 204; upserts chat_reads and marks that member's unread `chat_message` notifications read.

## Socket.IO — core owner: **backend**; chat handlers: **chat**
- Same origin, path `/socket.io`. Handshake authenticated from the `hsh_session` cookie (parse `socket.request.headers.cookie`); unauthenticated → `next(new Error('unauthorized'))`. Each socket joins room `member:<id>`.
- Event types: `ServerToClientEvents` / `ClientToServerEvents` in `shared/types.ts`.
- `server/src/realtime.ts` (backend) exports:
  - `initRealtime(httpServer): Server` · `getIO(): Server`
  - `broadcast(event, payload)` — to all signed-in sockets
  - `emitToMember(memberId, event, payload)` · `broadcastExcept(memberId, event, payload)`
  - `onSocketConnection(handler: (socket, member: AuthMember) => void)` — register extra handlers (chat uses it for typing)
  - `onlineMemberIds(): number[]` · `isOnline(id): boolean`
  - Presence: on first socket of a member → `presence:update {online:true}`; on last disconnect → update `members.last_seen_at` and emit `{online:false}`; new sockets receive `presence:state`.
- Emit **after** the DB transaction commits. Payloads are small "something changed" signals (`menu:changed`, `booking:changed`) — clients refetch via React Query. `chat:message` carries the full message.
- `server/src/chatSocket.ts` (chat) exports `registerChatSocket(): void` — uses `onSocketConnection` to relay `chat:typing` to everyone except the sender (throttle; auto-clear after 5 s).

## Notifications — `server/src/notify.ts` (backend) exports
```ts
notify(opts: {
  recipients: number[] | 'everyone-except-actor' | 'admin';
  actorId: number | null;
  kind: NotificationKind;
  title: string; body?: string; link: string;
  dedupeKey?: string;   // unread row with same (recipient, dedupeKey) gets count+1, fresh title/body/created_at instead of a new row
}): Promise<void>      // inserts, then emits 'notification:new' to each recipient; never throws into the caller (logs)
```
Policy (feature owners call it): menu published → everyone except actor (`menu_published`); menu edited → everyone except actor, dedupeKey `menu_updated:<id>`; voting closed → everyone except actor; vote cast → `'admin'` only, dedupeKey `vote_cast:<menuId>` (one coalesced row: "3 new votes on Rice + Sambar"), skip when the voter is Rohit; booking created/cancelled → everyone except actor; chat message → everyone except sender, dedupeKey `chat_message` (one coalesced unread "5 new messages" row per recipient), cleared by `/api/chat/read`. The client suppresses the toast for `chat_message` while the chat page is open.

## Backup format — `server/src/backup.ts` (backend) exports `exportData(db?)`, `importData(data, client)`
```json
{ "app": "homesweethome", "version": 1, "exportedAt": "ISO", "tables": {
  "members": [...], "cooking_menus": [... image as base64 string ...], "cooking_votes": [...],
  "washing_bookings": [...], "chat_messages": [...], "chat_reads": [...], "notifications": [...] } }
```
Sessions are never exported. Restore runs in one transaction: disables the window trigger for historical rows (`ALTER TABLE washing_bookings DISABLE TRIGGER washing_bookings_in_window` then re-enable), truncates content tables, re-inserts, resets sequences with `setval`. Members are upserted (keeps PIN hashes and bios). Used by the Settings page (Rohit) and by `scripts/backup.ts` / `scripts/restore.ts`.

## Client routes & files
`/login`, `/` (dashboard), `/cooking`, `/washing`, `/chat`, `/members`, `/settings`. Unauthenticated → `/login`. Toasts via `import { toast } from 'sonner'` (Toaster mounted in App).
Desktop: slim left sidebar. Mobile: bottom tab bar (Home, Cooking, Washing, Chat, Members) + Settings via header avatar. Dark theme only (default).
Feature pages export a default component: `client/src/pages/CookingPage.tsx`, `WashingPage.tsx`, `ChatPage.tsx`. Dashboard widgets the frontend may import: `client/src/features/cooking/TodayMenuCard.tsx` (default export, props none), `client/src/features/washing/WeekStrip.tsx` (default export, props none), `client/src/features/chat/RecentMessages.tsx` (default export, props `{ limit?: number }`).

## Design direction
"A flat at night, lit by one warm lamp." Dark plum surfaces (`night/room/wall/seam`), warm-white text (`jasmine/dusk/haze`), ONE accent: saffron `lamp`. States: `leaf` = available/want, `chili` = booked/don't want, `ash` = past. Font: Bricolage Grotesque (one family; use weight/optical size for hierarchy). Signature motif: **the household strip** — six faces everywhere, each carrying live state (vote ring, presence dot, who booked). Avoid: ALL-CAPS eyebrow labels, "A · B · C" meta strings, "→" in buttons, monospace labels, gradient washes, identical-card grids everywhere, decorative entrance animations on every section. Motion only in response to actions (vote ring change, booking confirm), plus one login-screen entrance. Copy: sentence case, plain verbs; button label = toast text ("Book Tue 24 Nov" → "Booked Tue 24 Nov"). Respect reduced motion, visible focus, ≥ 4.5:1 text contrast, works at 360px width.

## File ownership (edit ONLY your files; read anything)
| Agent | Owns |
|---|---|
| lead | everything listed in "Already written", `package.json`, `server/vitest.config.ts` (if lead writes it) |
| backend | `server/src/{app,index,migrate,seed,auth,realtime,notify,backup,presence}.ts`, `server/src/routes/{auth,members,admin,meta,notifications,health}.ts` |
| features | `server/src/routes/{cooking,washing}.ts`, `server/src/images.ts`, `client/src/pages/{CookingPage,WashingPage}.tsx`, `client/src/features/cooking/**`, `client/src/features/washing/**` |
| chat | `server/src/routes/chat.ts`, `server/src/chatSocket.ts`, `client/src/pages/ChatPage.tsx`, `client/src/features/chat/**` |
| frontend | `client/src/{main,App}.tsx`, `client/src/components/**` (keep the existing props contract of ui.tsx/Avatar.tsx), `client/src/pages/{LoginPage,DashboardPage,MembersPage,SettingsPage,NotFoundPage}.tsx`, `client/src/features/{shell,notifications,settings}/**`, `client/src/lib/{auth,realtime}.ts(x)`, `client/public/**` except `avatars/`, `client/src/styles.css` (may extend tokens) |
| testing | `server/test/**`, `server/vitest.config.ts`, `e2e/**`, `docs/TESTING.md` |
| deploy | `render.yaml`, `README.md`, `.env.example`, `docs/DEPLOY.md`, `scripts/{backup,restore}.ts`, `scripts/process-avatars.mjs`, `client/public/avatars/**` |

### Server bootstrap (backend) — testing depends on this exact API
- `server/src/app.ts` exports `createApp(): express.Express` (no listening, no migrations).
- `server/src/index.ts` exports `startServer(opts?: { port?: number; host?: string }): Promise<{ url: string; port: number; close(): Promise<void> }>` which runs migrations + seed, creates the HTTP server, `initRealtime`, `registerChatSocket()`, serves `client/dist` with SPA fallback (non-`/api` GETs → index.html), and listens. It auto-runs only when executed directly (`process.argv[1]` resolves to this file). Handles SIGTERM gracefully. Retries the initial DB connection (up to ~60 s) so a cold start survives a slow database.
- `server/src/migrate.ts` exports `migrate(): Promise<string[]>` (applies pending `server/migrations/*.sql` in name order, records them in `schema_migrations`, guarded by `pg_advisory_lock`). `server/src/seed.ts` exports `seedMembers(): Promise<void>` (idempotent upsert of the six; never touches `pin_hash`/`bio` of existing rows).

`app.ts` (backend) mounts: `/api/cooking` ← `routes/cooking.ts` default export Router; `/api/washing` ← `routes/washing.ts`; `/api/chat` ← `routes/chat.ts`; plus its own routers. `index.ts` calls `registerChatSocket()` after `initRealtime`. Each feature router applies `requireAuth` itself (`import { requireAuth, requireAdmin } from '../auth.js'`).
