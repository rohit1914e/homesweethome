# HomeSweetHome 🏠

A private home on the web for six roommates — **Rohit, Jagan, Bharath, Surya, Bazith and Dharun**.

- **Cooking** — Rohit publishes the day's menu (with an optional photo); everyone answers *OK, I want this* or *I don't want this*. Live tally, the six faces with their answers, close/reopen voting, history of today and yesterday (older menus and their votes are deleted automatically every hour).
- **Washing machine** — one machine, one person per day. Calendar with green (free), red (booked, with the booker's face) and grey (past / not open yet). Bookable window: **today + the next 5 days** (6 dates, Asia/Kolkata), rolling every midnight. Cancel your own booking; Rohit can manage anyone's. History kept.
- **Room cleaning** — Rohit assigns duties (floor, wall, bathroom, dusting, sweeping, mopping or a custom task) to anyone on any date, with optional instructions, and can edit, reassign or delete them. Members see their own duties and mark them done; status updates live; assignees get a notification.
- **Group chat** — real-time messages, faces, timestamps, emoji, typing indicator, online status, history.
- **Home / College status** — 🏠 At Home, 🎓 At College, 🚶 Away or 📍 Location unavailable, shown live with faces on the dashboard and Members page **only from 8 AM to 3 PM IST** (college hours; a status from an earlier day stays hidden until updated). Set by hand, or **automatically with GPS** (opt-in per member): the browser checks when the site opens and every 5 minutes while it stays open — nothing runs after it's closed. A manual pick overrides GPS for the day. Rohit sets the home/college areas (coordinates + radius) in Settings.
  - **Privacy:** a member's coordinates are compared with the two areas on the server and discarded — never stored, logged, or shown to anyone. Only the resulting status and its time are saved. The area coordinates are visible only to Rohit and are kept out of this public repo (`HOME_PLACE` / `COLLEGE_PLACE` env vars).
- **Members**, **notifications** (new menu, votes, bookings, cancellations, chat — coalesced, no duplicates), **settings** (bio, optional PIN; Rohit: PIN resets, sign-out-everywhere, backup & restore).

Rohit is the only administrator, but the app always shows him simply as "Rohit".

## Signing in — please read
Members sign in by **tapping their photo** (the owner's choice). On a public URL that means anyone who has the link can enter as any member **unless that member sets a PIN** (Settings → Sign-in PIN, 4–8 digits, stored bcrypt-hashed, rate-limited). **Rohit should set a PIN.** Don't post the link publicly.

## Stack
React 19 + TypeScript + Vite + Tailwind CSS v4 · Node.js + Express 5 · PostgreSQL · Socket.IO · deployed on **Render's free tier** (one web service serves the API, WebSockets and the built app).

## Run locally
Requires Node 22+ and PostgreSQL binaries (the scripts find `C:\Program Files\PostgreSQL\<ver>\bin` automatically).
```bash
npm ci
npm run db:local          # disposable local cluster on port 55432 (.pgdata/, git-ignored)
cp .env.example .env
npm run dev               # API on :3000, app on http://localhost:5173
# or the production build:
npm run build && npm start   # http://localhost:3000
```
Migrations and the six accounts are applied automatically at startup (idempotent; no duplicates on restart/redeploy).

### Profile photos
Put the originals in the project root as `rohit.jpg`, `jagan.jpg`, … (any of jpg/jpeg/png/webp). They are git-ignored. `npm run avatars` writes 512×512 face-centred WebP files (metadata stripped) to `client/public/avatars/`, which are committed and served online. Missing photos fall back to initials.

## Clearing data
`npm run db:clear -- --yes` deletes all menus, votes, bookings, chat, cleaning duties, notifications and sessions, and keeps the six accounts (set `DATABASE_URL` to target another database).

## Tests
```bash
npm test            # 137 server integration tests against the local test DB (auth, cooking, washing, cleaning, chat, realtime, concurrency)
# Run E2E against the TEST database so your own data (and PINs) are untouched:
npm run build && DATABASE_URL=postgres://postgres@localhost:55432/homesweethome_test NODE_ENV=production COOKIE_SECURE=false PORT=4174 npm start   # terminal 1
node e2e/smoke.mjs http://localhost:4174   # terminal 2 (needs no PINs set and a free washing day)
# The E2E browsers run at 10:30 IST; start the server with STATUS_CLOCK_OFFSET_MS=<10:30 IST today − now, in ms> so status hours agree. — two real browsers: live sync, persistence, responsive checks
```
Results: [docs/TESTING.md](docs/TESTING.md).

## Security model
- No registration path exists. The schema itself allows only member ids 1–6 with the six fixed names, and only Rohit can be admin (CHECK constraints).
- Session = random 32-byte token in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie; the database stores only its SHA-256. 30-day sliding expiry; Rohit can sign anyone out everywhere.
- Identity always comes from the session — the server never trusts a sender/voter/booker id sent by the browser.
- Every state-changing request needs the `X-HSH-Client` header (CSRF guard); same-origin only, strict CSP, Helmet headers.
- Admin rules are enforced in the API **and** by database triggers (menus can only be authored by Rohit; votes rejected once voting is closed; bookings only inside the window). A partial unique index guarantees one active booking per date even under simultaneous requests.
- No secrets in the frontend; all configuration via environment variables (`.env.example`).

## Deploy
Free Render deployment and the **free-database expiry runbook**: [docs/DEPLOY.md](docs/DEPLOY.md).

## Project layout
```
client/        React app (pages, features/{cooking,washing,chat,notifications,shell}, components, lib)
server/src/    Express app, auth, realtime (Socket.IO), routes, backup, migrations runner
server/migrations/  SQL schema
shared/types.ts     API + socket contract shared by client and server
scripts/       local DB, avatars, backup/restore
e2e/smoke.mjs  browser end-to-end test
render.yaml    Render Blueprint (free plan)
```
