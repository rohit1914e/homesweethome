# HomeSweetHome 🏠

A private home on the web for six roommates — **Rohit, Jagan, Bharath, Surya, Bazith and Dharun**.

- **Cooking** — Rohit publishes the day's menu (with an optional photo); everyone answers *OK, I want this* or *I don't want this*. Live tally, the six faces with their answers, close/reopen voting, full history.
- **Washing machine** — one machine, one person per day. Calendar with green (free), red (booked, with the booker's face) and grey (past / not open yet). Bookable window: **today + the next 5 days** (6 dates, Asia/Kolkata), rolling every midnight. Cancel your own booking; Rohit can manage anyone's. History kept.
- **Group chat** — real-time messages, faces, timestamps, emoji, typing indicator, online status, history.
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

## Tests
```bash
npm test            # 110 server integration tests against the local test DB (auth, cooking, washing, chat, realtime, concurrency)
npm run build && NODE_ENV=production COOKIE_SECURE=false PORT=4173 npm start   # terminal 1
npm run test:e2e    # terminal 2 — two real browsers: live sync, persistence, responsive checks
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
