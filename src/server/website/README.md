# 41st Portal Frontend

React + Vite frontend for the 41st officer/admin portal.

This app is not standalone in production. The Express server in the repo root serves the built files from `dist/`.

## Requirements

- Root project dependencies installed
- Frontend dependencies installed in this directory
- A working root `config.json`
- The backend server running if you want real API data

## Install

From the repo root:

```bash
cd src/server/website
npm install
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Build production assets into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |

## Development Workflows

### Option 1: Integrated dev through Express

From the repo root, use the server in development mode:

```bash
npm run dev
```

That mode mounts Vite middleware inside the Express server, so the portal is served by the backend process instead of a separate Vite port.

### Option 2: Standalone Vite frontend

From `src/server/website`, run the frontend here:

```bash
npm run dev
```

Run the backend separately from the repo root:

```bash
npm run server
```

`vite.config.js` proxies `/api` and `/auth` to `http://localhost:8081`.

If your backend runs on a different host or port, update `vite.config.js`.

## Production Build

From the repo root, the standard build command is:

```bash
npm run build
```

That writes the static frontend bundle to `src/server/website/dist`, which the Express server serves in production mode.

From `src/server/website`, you can also build directly:

```bash
npm run build
```

## Auth Notes

- Production login uses the backend Discord OAuth flow.
- Development login in `src/server/controllers/AuthController.js` currently redirects to `http://localhost:3000/`.
- If you run the frontend on a different dev URL, update that redirect or avoid using the dev auth shortcut as-is.

## Useful Context

- API client base URL: `/api`
- Auth routes are proxied through `/auth`
- Main app entry: `src/App.jsx`
- Shared UI lives under `src/components/ui`
