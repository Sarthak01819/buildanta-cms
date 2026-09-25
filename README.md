# buildanta-cms

The local project editor for the Buildanta site's **Projects** world.

It edits the site's own files — no database, no extra backend:

| What | Where (in the site repo) |
|---|---|
| The projects, in world order | `content/world.json` |
| Their images / videos | `public/world/art/` |

It is a **separate repo and a separate local server**, so none of it ever ships
with the website.

## Run it

```bash
npm start
```

Open **http://localhost:5300**. Needs Node 18+; no `npm install` (zero dependencies).

It expects the site next to it:

```
buildanta-site-handoff/
  buildanta-cms/                 ← this repo
  buildanta-site-optimized/      ← the site
```

Elsewhere? Point it at the site: `SITE_DIR=/path/to/buildanta-site-optimized npm start`.

## What you can do

- **Add / edit / delete** projects — title, author, caption, description (project page), link (`#/work/…`), accent colour, show-caption.
- **Upload** a JPG / PNG / WebP image or an MP4 video per project — drop it on the media box; its size is detected automatically.
- **Reorder** by dragging in the list — the order is where the cards sit in the world.
- **Preview site** opens the local dev site (`npm run dev -- --port 5303` in the site).
- **Save** (or Ctrl+S) writes `content/world.json`. The local dev site updates immediately.

## Going live

Saving only changes files on this computer. To publish, commit and push the
site repo (`content/world.json` and `public/world/art/`) — Vercel redeploys.

## Safety

- Local only: listens on `127.0.0.1`, rejects non-localhost hosts, and every
  write needs this run's random token plus a localhost origin.
- Nothing is deleted: every save keeps the previous `world.json` in `.backup/`,
  and media no project uses any more is moved to `.trash/` (both git-ignored).
- Uploads: only JPG/PNG/WebP/MP4, stored under generated names inside `public/world/art/`.
