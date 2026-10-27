# 41st Bot

Discord bot, web portal, background jobs, and Roblox tooling for the 41st.

Additional docs:

- [Portal README](src/server/website/README.md)

## What Is In This Repo

| Component       | Purpose                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| Discord bot     | Slash commands, event logging, verification, quotas, inactivity, and moderation helpers |
| Express server  | API endpoints, Discord auth, and the event-management portal backend                    |
| React portal    | Officer/admin dashboard served from `src/server/website`                                |
| Background jobs | VIP tracke and Roblox username cache updater                                            |

## Requirements

- Node.js 24+ and npm 11+ recommended
- MySQL 8.0.16+
- A Discord application and bot token
- A Roblox `.ROBLOSECURITY` cookie for Roblox-backed features
- `pm2` only if you want long-running production processes

## Quick Install

### 1. Install dependencies

From the repo root:

```bash
npm install
```

If you want the portal, install its frontend dependencies too:

```bash
cd src/server/website
npm install
```

Then return to the repo root for the remaining setup steps.

### 2. Create `config.json`

This project primarily reads configuration from `config.json` in the repo root. Prisma commands can also use `DATABASE_URL` when it is set.

```bash
cp configTemplate.json config.json
```

Fill in the values in `config.json` before running anything important.

### 3. Configure the required sections

Use `configTemplate.json` as the source of truth for every key. These sections matter most during install:

| Section                                                 | Required for                                         | Notes                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `DISCORD.BOT`                                           | Bot startup, slash-command deployment, guild lookups | Set `TOKEN`, `CLIENT_ID`, and `GUILD_ID` first                            |
| `DISCORD.ROLES`, `DISCORD.CHANNELS`, `DISCORD.WEBHOOKS` | Most commands and logs                               | Populate the IDs your server actually uses                                |
| `MYSQL`                                              | Anything that touches the database                   | The bot and server both read directly from this section                   |
| `ROBLOX`                                                | Verification, trackers, Roblox integrations          | `COOKIE`, group IDs, guarding ranks, and place ID are common requirements |
| `ROBLOX.OAUTH`                                          | Roblox OAuth2 redirect + token exchange flow         | Set `APP_ID`, `APP_SECRET`, and `REDIRECT_URI` (for this repo: `/api/auth/roblox/callback`) |
| `PORTAL`                                                | Web server and session handling                      | `SECRET`, `PORT`, `HOST`, and `CORS_PORT` are required for the portal     |
| `DISCORD.AUTH`                                          | Discord OAuth for the portal                         | Needed if you want users to log in through Discord                        |
| `EXTERNAL`                                              | External Roblox integrations                         | Needed for APIs like xTracker/Clanware if you use them                    |

### 4. Create or baseline the MySQL database

For a new empty database, create the target database first, then apply the Prisma migrations:

```bash
npm run prisma:migrate
```

For an existing MySQL database that already matches `prisma/schema.prisma`, baseline the initial Prisma migration once:

```bash
npm run prisma:baseline
npm run prisma:migrate
```

`prisma:baseline` records the initial migration as already applied without replaying it against the existing schema.

The Prisma CLI reads `DATABASE_URL` if present; otherwise `prisma.config.ts` builds the connection string from `config.json` -> `MYSQL`.

Use `MYSQL` in `config.json` (default port `3306`) or set `DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE`. Encode special characters in URL credentials. Runtime connections use UTC.

The schema migration creates empty MySQL tables. To copy an existing PostgreSQL deployment, stop the bot, server and background jobs that write to either database, then run:

```bash
# Set these in your shell or .env (URL-encode special characters in credentials).
export POSTGRES_DATABASE_URL='postgresql://USER:PASSWORD@POSTGRES_HOST:5432/DATABASE'
export MYSQL_DATABASE_URL='mysql://USER:PASSWORD@MYSQL_HOST:3306/DATABASE'

# Apply the schema to the destination before transferring.
DATABASE_URL="$MYSQL_DATABASE_URL" npm run prisma:migrate
npm run db:transfer -- --dry-run
npm run db:transfer
```

Alternatively, fill both `POSTGRES` (used only for transfer) and `MYSQL` sections in `config.json`, each with `USER`, `PASSWORD`, `HOST`, `PORT`, and `DATABASE`. The transfer script uses `POSTGRES_DATABASE_URL` for the source and `MYSQL_DATABASE_URL` for the destination when provided; the destination also accepts `DATABASE_URL`. URL settings take precedence over config sections. The application's normal database connection continues to use `MYSQL` or `DATABASE_URL`.

Badge caches, asset caches, and officer labels are excluded from the schema and transfer. Run `npm run prisma:migrate` to apply their removal on MySQL; this drops those three destination tables and their contents. PostgreSQL tables are left untouched.

The script copies all 14 application tables from PostgreSQL's `public` schema in foreign-key order. It preserves UUIDs, integer IDs, JSON numeric precision, and timestamps in UTC with microsecond precision. PostgreSQL arrays become JSON arrays of strings. PostgreSQL is read in one read-only snapshot, with cursor batches controlled by `TRANSFER_BATCH_SIZE` (default `500`, maximum `10000`). The source must have the columns from the original Prisma migration; missing tables or columns cause the transfer to fail rather than silently skipping data.

All destination application tables must be empty and use InnoDB. The script leaves `_prisma_migrations` alone, checks row counts for every table, and commits all inserts together. Any copy or validation failure rolls back destination inserts; `--dry-run` also rolls them back after verification. MySQL may still advance auto-increment counters during a rolled-back run. Keep writers stopped throughout both runs and until cutover; the source snapshot does not include changes made after it starts. The full destination copy remains in one transaction, so allow sufficient transaction/log space for large datasets. Inserts are sent as parameterized batches. Timestamped logs report preflight checks, source counts, table progress about every five seconds while copying, throughput, estimated time remaining, verification, and the final commit. Progress counters represent uncommitted inserts until the commit succeeds.

Connection attempts identify the database and host/port without printing credentials. Both connections have a 30-second connection timeout. If MySQL reports `ER_CONNECTION_TIMEOUT`, check that the host/port is reachable from the machine running the script, that MySQL listens on the network interface, and that firewall/IP allowlist and TLS settings permit the connection. You can set `?connectTimeout=60000` on `MYSQL_DATABASE_URL` for a slower connection.

No `.env` file is required. In `config.json`, `MYSQL` also accepts `ALLOW_PUBLIC_KEY_RETRIEVAL` (boolean), `SSL` (boolean), `CONNECT_TIMEOUT` (milliseconds), `CACHING_RSA_PUBLIC_KEY`, and `RSA_PUBLIC_KEY` (trusted key path/content). These options apply to the transfer script and normal application connections. For the RSA authentication error on a trusted local/private connection, set `"ALLOW_PUBLIC_KEY_RETRIEVAL": true` inside `MYSQL`, then rerun `npm run db:transfer -- --dry-run`.

If MySQL reports `ER_CANNOT_RETRIEVE_RSA_KEY`, the server is reachable but authentication needs TLS or an RSA public key. Use verified TLS (`ssl=true`) or a trusted server key (`cachingRsaPublicKey` / `rsaPublicKey`). For a trusted local/private connection, you can explicitly permit key retrieval by adding `allowPublicKeyRetrieval=true` to `MYSQL_DATABASE_URL`. Use `?` before the first URL option and `&` before subsequent options. Public key retrieval alone does not verify the server identity; prefer verified TLS for remote connections.

To watch an already-running transfer without restarting it, open another terminal in the project directory and run `npm run db:transfer:monitor`. It uses the same `config.json` connections and polls destination activity metadata every five seconds. Use `-- --once` for one update or `-- --interval=10` for ten-second updates. Ctrl+C stops only the monitor. It never queries application rows, locks tables, or controls other sessions.

With MySQL `PROCESS` privilege, the monitor reports each visible destination transaction's age, state, uncommitted modified-row counter, and approximate rate since the last sample. Without that privilege it falls back to visible session activity. It shows the current/last observed table when available, without printing SQL or row values. Other writers may also appear. Exact percentage, total rows, and proof of completion cannot be recovered reliably from an already-running transfer; disappearing activity can mean commit, rollback, or disconnect. Check the original transfer terminal for its final result.

To check committed data, run `node src/scripts/checkTransfer.js`. This standalone read-only script uses the same connection settings and compares PostgreSQL and MySQL row counts across all 14 application tables. Keep application writers stopped. Exit code 0 means all counts match and the source is nonempty; exit code 1 means mismatches, empty databases, or an error. Matching counts are consistent with completion but do not verify row contents or prove a particular transfer succeeded. An ongoing transfer's uncommitted inserts are not visible; rerun after it commits.

After success, configure the application to use the destination MySQL database and start it. Keep PostgreSQL and its migration history as a rollback backup. Do not baseline the MySQL migration against PostgreSQL. Use `npm run db:transfer -- --help` for connection and option details.

### 5. Deploy Discord slash commands

After `config.json` is filled in:

```bash
npm run deploy
```

If you skip this, the bot can log in successfully but its slash/context commands will not show up correctly.

### 6. Start the pieces you need

Most installs need at least the bot:

```bash
npm run bot
```

For local portal development, run the server separately:

```bash
npm run dev
```

Optional background jobs:

```bash
npm run tracker
npm run updater
```

## Common Install Modes

### Bot only

Use this if you just want Discord automation:

1. Install root dependencies
2. Create `config.json`
3. Run `npm run prisma:migrate`
4. Run `npm run deploy`
5. Run `npm run bot`

### Bot + portal

Use this if you want the dashboard/API too:

1. Install root dependencies
2. Install frontend dependencies in `src/server/website`
3. Create `config.json`
4. Run `npm run prisma:migrate`
5. Build the frontend for production with `npm run build`, or use `npm run dev` for development
6. Run `npm run server` or `npm run dev`
7. Run `npm run bot` in a separate terminal/process

## Scripts

| Command           | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `npm run deploy`  | Register slash/context commands with Discord                      |
| `npm run bot`     | Start the Discord bot                                             |
| `npm run dev-bot` | Start the bot with `NODE_ENV=development`                         |
| `npm run server`  | Start the Express server in production mode                       |
| `npm run dev`     | Start the Express server in development mode with Vite middleware |
| `npm run build`   | Build the portal frontend in `src/server/website/dist`            |
| `npm run tracker` | Start the VIP guarding tracker                                    |
| `npm run updater` | Refresh cached Roblox username/ID files                           |
| `npm test`        | Run Jest tests                                                    |
| `npm run prisma:generate` | Generate the Prisma client                               |
| `npm run prisma:migrate`  | Apply Prisma migrations to the configured database         |
| `npm run prisma:baseline` | Mark the initial migration applied for an existing database |
| `npm run prisma:dev`      | Create/apply a development migration                       |
| `npm run prisma:studio`   | Open Prisma Studio                                         |

## Production With PM2

Install `pm2` globally if you want the processes to stay alive across restarts:

```bash
npm install -g pm2
```

Typical process set:

```bash
pm2 start npm --name "41st Discord Bot" -- run bot
pm2 start npm --name "41st Server" -- run server
pm2 start npm --name "41st VIP Tracker" -- run tracker
pm2 start npm --name "41st Roblox Updater" -- run updater
```

Run `npm run build` before starting the production server so `src/server/website/dist` exists.

## Portal Notes

- The frontend lives in `src/server/website` and has its own `package.json`.
- The production server serves `src/server/website/dist`.
- Discord OAuth for the portal needs both `DISCORD.AUTH.CLIENT_SECRET` and `DISCORD.AUTH.REDIRECT_URI`.
- Roblox OAuth2 redirect flow endpoints:
  - Start: `/auth/roblox` (or `/api/auth/roblox/start`)
  - Callback URL to register in Roblox app settings: `https://41st.spiider.dev/api/auth/roblox/callback`
- `PORTAL.PORT` is the Express server port; `PORTAL.CORS_PORT` is used for allowed frontend origin handling.

## Important

- Some commands assume your Discord role/channel IDs are fully populated in `config.json`; leaving those blank usually leads to command failures later.
- Roblox-backed features depend on a valid `.ROBLOSECURITY` cookie.

## Troubleshooting

| Problem                                  | What to check                                          |
| ---------------------------------------- | ------------------------------------------------------ |
| `Cannot find module '../../config.json'` | Create `config.json` from `configTemplate.json`        |
| Slash commands do not appear             | Verify `DISCORD.BOT` values and rerun `npm run deploy` |
| Database errors on startup               | Confirm `MYSQL` values and run `npm run prisma:migrate` |
| `The database schema is not empty`       | Existing DB: run `npm run prisma:baseline`, then `npm run prisma:migrate` |
| Portal build/start fails                 | Install `src/server/website` dependencies and rebuild  |

Transfer orphan handling: `node src/scripts/transferPostgresToMysql.js --skip-orphans` explicitly excludes rows in `all_time_events_index` and `all_time_event_points` whose `robloxid` has no parent in `roblox_ids`. It reports excluded counts per table and in the final summary, without changing PostgreSQL. The default still rejects these rows. Verify this intentional subset using `node src/scripts/checkTransfer.js --skip-orphans`.
