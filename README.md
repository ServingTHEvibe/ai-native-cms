# AI-native Client CMS

Ingest any URL into editable **content slots** layered over a **frozen template**, edit
inline or by chat, validate every change through a deterministic **Guardian**, keep full
**version history with one-click rollback**, manage **many client sites**, and **publish**
immutable snapshots to each site's host (Vercel).

Built to be run whenever you want **and** resold: every client gets their own site, their
own login, and their site is published to their own host.

## How it works

1. **Ingest** — `POST /api/sites` (or `/pages`) with a URL. The HTML is fetched and parsed;
   every text / image / button / link becomes a slot with a stable id (`text-1`, `img-2`, …).
   Everything else is frozen template.
2. **Content model** — design and content are separate. The template never changes
   structurally; only slot values do.
3. **The Guardian** (`src/guardian.js`) — a deterministic, no-AI validator. Every proposed
   change (manual or AI) is checked before it is applied. It rejects malformed values, unsafe
   URLs (`javascript:` etc.), unknown slot ids, and anything that removes or empties a
   structural section.
4. **Editor** — click any highlighted element in the live preview to edit it inline, or use
   the chat box. The preview re-renders template + content.
5. **AI chat (optional)** — turns plain English into a structured slot change, then runs it
   through the same Guardian. Supports **Anthropic** or **OpenRouter** keys.
6. **Versions & rollback** — every save is snapshotted; roll back to any version in one click.
7. **Publish** — renders the current content into a clean static bundle, deploys it to the
   site's Vercel project, and keeps the exact bytes as an immutable snapshot.

## Auth

- **Owner** logs in with `OWNER_MASTER_KEY` → full access to every site.
- **Client** logs in with a per-site password → only ever sees their own site.

## Storage

Filesystem by default (`./data`). Set `MONGODB_URI` to use MongoDB (required for any
persistent deployment on serverless hosts like Vercel, whose filesystem is ephemeral).

## Run locally

```bash
npm install
cp .env.example .env      # set OWNER_MASTER_KEY + SERVER_SECRET (and MONGODB_URI / AI keys if you want)
npm start                 # http://localhost:3000
npm test                  # core engine smoke tests
```

## Deploy on Vercel

This repo includes `vercel.json` and `api/index.js`, so the whole Express app runs as a
serverless function. Set these environment variables in the Vercel project:

- `OWNER_MASTER_KEY`, `SERVER_SECRET`
- `MONGODB_URI`, `MONGODB_DB` (use MongoDB Atlas so data persists)
- optional: `ANTHROPIC_API_KEY` **or** `OPENROUTER_API_KEY`
- optional: `VERCEL_TOKEN` (so the Publish button can deploy client sites)

## Publishing client sites to their own host

Give a site its own Vercel host via `PATCH /api/sites/:id` with:

```json
{ "host": { "provider": "vercel", "token": "<client or your vercel token>", "projectName": "client-site", "teamId": "team_..." } }
```

When you hit **Publish**, the static bundle is deployed there and recorded as an immutable
snapshot. With no token, the snapshot is still saved and viewable at `/s/<snapshotId>/`.
