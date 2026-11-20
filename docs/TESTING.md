# Testing report — HomeSweetHome (2026-11-20)

All results below were observed by running the commands on Windows 11, Node 24, PostgreSQL 17 (local disposable cluster).

| Check | Command | Result |
|---|---|---|
| Server type-check | `npx tsc -p server/tsconfig.json --noEmit` | ✅ 0 errors |
| Client type-check | `npx tsc -p client/tsconfig.json --noEmit` | ✅ 0 errors |
| Production build | `npm run build` | ✅ client (Vite) + server (tsc) built |
| Schema constraints | psql probe in a rolled-back transaction | ✅ 7th member, 2nd admin, non-Rohit menu, duplicate vote, vote after close, duplicate date, past date, beyond-window date all rejected by the database |
| Integration tests | `npm test` | ✅ **110 / 110 passed** (4 files) |
| Browser E2E | `npm run test:e2e` (production build on :4173) | ✅ **31 / 31 checks passed** |
| Backup → restore | `npm run db:backup`, `npm run db:restore -- <file> --yes` | ✅ round-trip into a second database |

## Integration suites (`server/test/`)
- **auth (48)** — all six can sign in; exactly six members, names exact, never "Admin"; unknown member 404; no registration route; every protected route 401 without/with a bad cookie; CSRF header required; logout invalidates the session; optional PIN flow (pin_required / invalid_pin / 200) and 429 rate limit; Rohit-only admin routes 403 for others; PIN reset; backup download + restore round-trip; migrate + seed idempotent (still 6, Rohit's PIN and bio preserved).
- **cooking (21)** — only Rohit publishes/edits/deletes/closes; all six vote; changing a vote never inflates totals; votes persist; 409 after close; reopen; history; `menu:changed` broadcast live; image upload accepted/served, disguised non-image rejected; vote notifications coalesce and skip Rohit's own vote.
- **washing (22)** — today and today+5 bookable; today+6 and yesterday → 422; duplicate → 409 naming the holder; **six simultaneous requests for one date → exactly one 201, five 409**; non-admin can't book for others; Rohit books on behalf; cancel own / Rohit cancels any / others → 403; history keeps cancellations; `booking:changed` live; failed booking sends no event.
- **chat (19)** — send; forged sender id ignored (identity from session); live delivery to another member's socket; persistence across server restart; pagination; idempotent retry; empty / >2000 chars → 422; unauthenticated HTTP 401 and socket rejected; typing relayed to others only and auto-clears; chat notifications coalesce and `/read` clears them.

## E2E (`e2e/smoke.mjs`, real Chromium, Rohit on desktop + Jagan on a mobile viewport)
Signed-out redirect to /login · six portraits, exact names, no "Admin" · dashboard greets the member · Rohit publishes → Jagan sees it **without reload** · Jagan has no publish control · Jagan votes → Rohit's tally updates **live** · vote persists after refresh · Jagan books a green day → Rohit's calendar shows it red with Jagan's name **live** and it's no longer bookable · chat message delivered **live** and persists after refresh · no horizontal scrolling on all 6 pages at 360 px, 820 px and 1440 px · no console errors after sign-in.

## Not verifiable locally
The live Render deployment (free web service + free Postgres) can only be verified after the owner applies the Blueprint — see docs/DEPLOY.md step 6.
