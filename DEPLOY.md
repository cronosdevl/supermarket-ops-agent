# Deployment

The bot is a single always-on Node process. It uses **long-polling** (only
*outbound* internet — no public URL or open port), stores data in **SQLite**, and
runs **cron jobs** (khata reminders, weekly deck), so it needs to stay running
with a **persistent data directory**. The catalogue **auto-seeds on first boot**,
so a fresh deploy comes up stocked with nothing to run manually.

Pick one of the three options below. All are portable — the same setup runs on
your Windows Server today and on any Linux VPS later.

> **One bot token = one running instance.** Telegram rejects a second poller for
> the same token (HTTP 409). Don't run `npm run dev` locally while the deployed
> bot is live. For parallel dev + prod, use a second bot token.

---

## Prerequisites

- Node.js 20+ (or Docker)
- `.env` in the project root:

```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=123456:ABC-your-bot-token
# optional — see README for the full list
# OWNER_CHAT_ID=123456789     # target for proactive reminders / weekly deck
# TZ=Asia/Kolkata
```

---

## Option A — Docker Compose (recommended, most portable)

Works identically on Windows (Docker Desktop) and any Linux VPS.

```bash
docker compose up -d --build      # build + start in the background
docker compose logs -f            # watch it connect to Telegram
```

- Data (the SQLite DB) lives on the named volume `store-data`, so stock / khata /
  preferences survive restarts and redeploys.
- `restart: unless-stopped` brings it back after a crash or host reboot (enable
  "start Docker Desktop on login" on Windows).
- **Update:** `git pull && docker compose up -d --build`.
- **Stop:** `docker compose down` (keeps the volume; add `-v` to also delete data).

**Move to a VPS:** copy the repo + `.env`, run the same `docker compose up -d
--build`. To carry data across, migrate the `store-data` volume (or copy
`store.db`).

---

## Option B — pm2 (no Docker; cross-platform)

Runs the compiled build under a process manager on Windows or Linux.

```bash
npm ci
npm run build
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save                          # persist the process list
pm2 logs supermarket-ops-agent
```

**Start on boot:**
- **Linux:** `pm2 startup` then run the command it prints.
- **Windows:** `npm i -g pm2-windows-startup && pm2-startup install` (or run
  `node dist/index.js` as a service via [NSSM](https://nssm.cc) / Task Scheduler).

Secrets are read from `.env` in the project directory (loaded by the app). Data
goes to `./data/store.db` by default — set `DB_PATH` to an absolute path if you
prefer a fixed location.

**Move to a VPS:** copy the repo, `npm ci && npm run build`, `pm2 start
ecosystem.config.cjs`. Copy `data/store.db` to keep existing data.

---

## Option C — Plain Node (simplest, e.g. inside `screen`/`tmux` or a service)

```bash
npm ci
npm run build
npm start                         # = node dist/index.js
```

Keep it alive with your init system of choice (systemd unit on Linux, a Windows
Service via NSSM, `screen`/`tmux` for a quick run). Data is at `./data/store.db`
(override with `DB_PATH`).

---

## Persistence & backups

Everything durable is one SQLite file (`DB_PATH`, default `./data/store.db`).
Back it up by copying that file (plus its `-wal` / `-shm` siblings if present),
or the Docker `store-data` volume. Generated invoices/decks under `artifacts/`
are transient (regenerated on demand) and don't need backing up.

## Verifying a deploy

On boot you should see:

```
✓ Seeded catalogue (empty database)      # first boot only
✓ Connected to Telegram as @YourBot (model: claude-opus-4-8)
✓ scheduler: khata reminders @ "0 10 * * *" (Asia/Kolkata)
✓ scheduler: weekly deck @ "0 9 * * 1" (Asia/Kolkata)
✓ Bot is running.
```

Then message the bot on Telegram and walk through **[TESTING.md](TESTING.md)**.
