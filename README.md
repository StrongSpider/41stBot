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
- PostgreSQL 13+ (`schema.sql` uses `pgcrypto`)
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

This project does not use `.env`. It reads configuration from `config.json` in the repo root.

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
| `POSTGRES`                                              | Anything that touches the database                   | The bot and server both read directly from this section                   |
| `ROBLOX`                                                | Verification, trackers, Roblox integrations          | `COOKIE`, group IDs, guarding ranks, and place ID are common requirements |
| `PORTAL`                                                | Web server and session handling                      | `SECRET`, `PORT`, `HOST`, and `CORS_PORT` are required for the portal     |
| `DISCORD.AUTH`                                          | Discord OAuth for the portal                         | Needed if you want users to log in through Discord                        |
| `EXTERNAL`                                              | External Roblox integrations                         | Needed for APIs like xTracker/Clanware if you use them                    |

### 4. Create the PostgreSQL database and load the schema

Create the target database first, then load `schema.sql`:

```bash
PGPASSWORD='<POSTGRES_PASSWORD>' psql \
  -h '<POSTGRES_HOST>' \
  -p <POSTGRES_PORT> \
  -U '<POSTGRES_USER>' \
  -d '<POSTGRES_DATABASE>' \
  -f schema.sql
```

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
3. Load `schema.sql`
4. Run `npm run deploy`
5. Run `npm run bot`

### Bot + portal

Use this if you want the dashboard/API too:

1. Install root dependencies
2. Install frontend dependencies in `src/server/website`
3. Create `config.json`
4. Load `schema.sql`
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
- `PORTAL.PORT` is the Express server port; `PORTAL.CORS_PORT` is used for allowed frontend origin handling.

## Important

- Some commands assume your Discord role/channel IDs are fully populated in `config.json`; leaving those blank usually leads to command failures later.
- Roblox-backed features depend on a valid `.ROBLOSECURITY` cookie.

## Troubleshooting

| Problem                                  | What to check                                          |
| ---------------------------------------- | ------------------------------------------------------ |
| `Cannot find module '../../config.json'` | Create `config.json` from `configTemplate.json`        |
| Slash commands do not appear             | Verify `DISCORD.BOT` values and rerun `npm run deploy` |
| Database errors on startup               | Confirm `POSTGRES` values and rerun `schema.sql`       |
| Portal build/start fails                 | Install `src/server/website` dependencies and rebuild  |
