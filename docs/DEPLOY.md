# Deploying HomeSweetHome on Render — FREE plan (₹0)

Everything here uses only Render's **Free** instance types. `render.yaml` sets `plan: free` for both the web service and the database. **If Render ever shows a price other than $0 / Free, stop — do not click Apply.**

## One-time deployment (about 10 minutes)
1. **Create a Render account** at <https://dashboard.render.com/register> — choose **Sign up with GitHub** (use the account that owns `rohit1914e/homesweethome`).
2. Allow Render to access the repository when GitHub asks (you can grant access to just `homesweethome`).
3. In the Render dashboard click **New +** → **Blueprint**.
4. Select the **homesweethome** repository → branch **main**. Render reads `render.yaml` and shows two resources:
   - `homesweethome` — Web Service — **Free**
   - `homesweethome-db` — PostgreSQL — **Free**
   Give the Blueprint a name (e.g. `homesweethome`). **Check both say Free.** Then click **Apply** / **Deploy Blueprint**.
5. Wait for the database to become *Available* and the web service build to finish (first build ≈ 3–6 min). Logs should end with `HomeSweetHome listening on 0.0.0.0:10000 (production)` and `[db] applied migrations: 001_init.sql`.
6. Open the web service → copy its URL (`https://homesweethome-xxxx.onrender.com`). Check `https://…onrender.com/api/health` shows `{"ok":true,"db":true}`.
7. Open the URL, tap **Rohit**, go to **Settings → Sign-in PIN** and set a PIN (recommended — see README "Signing in").
8. Share the URL privately with the five others. Each taps their own photo.

Auto-deploy: every `git push` to `main` rebuilds and redeploys automatically (`autoDeployTrigger: commit`). Roll back from the service's **Events** page (free tier keeps the 2 most recent deploys).

## Free tier limits & your data — read this
| Limit | What it means for the room |
|---|---|
| Web service **sleeps after 15 min** without traffic | The first visit after a quiet period shows Render's loading page for **about 1 minute**, then the app opens. The app shows "Waking up the house…" and reconnects live updates automatically. |
| **750 free instance hours / month** per workspace | Enough for one service (a month is ≤ 744 h). Don't add other free services to this workspace. |
| No persistent disk | Nothing is stored on disk — all data lives in PostgreSQL; photos are part of the build. |
| **Free PostgreSQL expires 30 days after it is created** | Then a **14-day grace period** to upgrade; after that Render **deletes the database and all data**. Free databases have **no backups**. Only **one** free database per workspace. |

**Data on the free tier is not permanent.** It survives only as long as you keep backups and move to a fresh free database every month.

Write down: *database created on ____ → expires on ____ (+30 days) → deleted on ____ (+44 days).* Render also emails you before expiry.

### Backups (do this at least weekly)
- Easiest: sign in as **Rohit → Settings → House settings → Download backup**. Keep the `.json` file safe (it contains the chat history).
- From a laptop: copy the database's **External Database URL** (Render → homesweethome-db → Connect) and run
  `DATABASE_URL="<external url>" npm run db:backup` → file in `backups/`.

### Monthly move to a fresh free database (before day 30)
1. **Download a backup** (above). Open the file once to check it isn't empty.
2. Render → `homesweethome-db` → **Settings → Delete Database** (required: only one free database is allowed).
3. Render → your Blueprint → **Manual sync** (or **New + → Blueprint** again with the same repo). It recreates `homesweethome-db` (Free) and re-links `DATABASE_URL` automatically.
4. The web service redeploys (trigger **Manual Deploy → Deploy latest commit** if it doesn't). On startup it migrates and recreates the six accounts.
5. Sign in as Rohit → **Settings → Restore from backup** → choose the file → confirm. Everything (menus, votes, bookings, chat, PINs, bios) is back.
   (Alternative from a laptop: `DATABASE_URL="<new external url>" npm run db:restore -- backups/<file>.json --yes`.)

Members stay signed out after a move (sessions are deliberately not backed up) — they just tap their photo again.

### Keep-awake pingers?
An external uptime pinger every 10 min would avoid the 1-minute wake-up but keeps the service running ~24/7 (≈ 744 h — right at the 750 h limit) and does **nothing** about the 30-day database expiry. Not recommended unless the wake-up delay really bothers you.

## Troubleshooting
- **Build fails**: open the deploy log. `npm ci` needs `package-lock.json` committed (it is). Node 22 is pinned via `NODE_VERSION` / `.node-version`.
- **Health check fails / "failed to start"**: the log shows `[db] not ready` retries for up to 60 s, then the error. Check the database is *Available* and `DATABASE_URL` exists under the service's **Environment** (it is linked from the database by the Blueprint).
- **"Reconnecting…" banner stays**: the service restarted or slept; it reconnects automatically. Refresh if it persists.
- **Database expired**: you're in the 14-day grace period — download a backup **now** (laptop method may fail once suspended; restore from your latest saved backup), then follow the monthly move.

## Never-pay checklist
- [ ] Both resources show **Free** before Apply.
- [ ] Never click *Upgrade* on the database expiry email or the workspace.
- [ ] Don't add a payment method unless Render requires one for something you understand; nothing in this project needs it.
