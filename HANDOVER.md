# Buildanta — Projects Admin (handover)

This is the **admin panel for the "Our Projects" section** — the part of the
Buildanta site where you fall into the black hole and all our client projects
float around you as cards.

You (frontend) already have the site. This package is only the back office
that feeds it: log in → add/edit a project → upload photos & videos → paste a
link → publish.

Extracted 25 Sep 2026 from the private repo `1710yashraj-builder/buildanta-cms`.

---

## 1. What's in the box

| Folder | What it is |
|---|---|
| `admin/` | The admin panel. React 18 + Vite 5 single-page app, runs on port 5300. |
| `supabase/` | The database, logins and file storage (Supabase). `migrations/` builds everything from empty. |
| `tools/` | Node scripts: **build-content** (turns published data into the JSON + media the site reads), importers, and test suites. |
| `docs/SCHEMA.md` | Why the database is shaped the way it is. Read this before changing tables. |
| `reference/world.json.sample` | The exact JSON the site currently reads — 58 projects (46 still placeholders). |
| `reference/site-code/` | How the site *displays* a project: `project-page.js` (the `#/work/<slug>` page) and `details.js` (the card info panel). For reference only. |
| `.env.example` | The two settings the admin needs. |

No passwords, keys or `.env` files are included. The admin only ever uses the
public "anon" key; it refuses to start if handed a service key.

---

## 2. Screens in the admin

| Screen | File | Does |
|---|---|---|
| Login / sign-up | `Login.jsx` | First account ever created = **owner**. Everyone after = **viewer** until the owner promotes them. |
| Projects list | `Projects.jsx` | All projects in grid order, add new, rename inline, open to edit. |
| Project editor | `ProjectEditor.jsx` | Every field below + live card preview (`CardPreview.jsx`). |
| Media library | `MediaLibrary.jsx` | Every uploaded photo/video. Size and colour are read automatically on upload (`media.js`). |
| Site content | `SiteContent.jsx` | Non-project text (intro, services, contact). Not the focus of this handover. |
| Publish | `Publish.jsx` | Shows Added / Changed / Removed / Renamed before you publish, then publishes one snapshot. |

---

## 3. Every field on a project

What the editor shows → what the database stores → what the site receives.

| Label in admin | DB column (`projects`) | Rules | Sent to site as |
|---|---|---|---|
| **Name of the project** | `title` | Required | `title` |
| (auto from name) | `slug` | lowercase, digits, hyphens only; unique | part of `link` → `#/work/<slug>` |
| **Who made it** | `author` | default `Buildanta` | `author` |
| **One line about it** | `caption` | optional | `caption` |
| "Show this line under the photo" | `show_caption` | yes/no | `show_caption` |
| **The full story** | `body` | optional, long text | `body` |
| **The colour** | `accent` | `#RRGGBB`; auto-picked from the image, editable | `color` |
| **Photo** ("Add a photo" / "Change photo") | `card_media` → `media` | image or video; **required for a live project** | `type`, `file`, `image_size` |
| **More pictures** ("Add a picture") | `project_media` (ordered) | any number of images/videos | `gallery[]` → `{type, file, image_size}` |
| **When someone clicks the photo** | `link_mode` | `internal` / `external` / `none` | `link` |
| Web address ("Add the web address") | `link_url` | must start `http://` or `https://`; required for external | `link` |
| Order in the grid (set on create; no drag yet) | `position` | spaced 10, 20, 30… | array order |
| **On the website** | `is_live` | can't be on without a main photo | only live projects are sent |

**The three link choices:**

| Choice in admin | `link_mode` | Card links to |
|---|---|---|
| A page on our website | `internal` | `#/work/<slug>` — the project page on our site |
| A different website | `external` | the pasted URL, new tab |
| Nowhere | `none` | nothing — the card just opens big |

**Media rules** (`media` table + storage bucket `media`):
- Allowed: JPG, PNG, WebP, AVIF, MP4, WebM. Max 50 MB per file.
- `width` and `height` are recorded on upload and **drive the card's shape**.
  Never drop them — a missing size is how art gets squashed.
- Each file also stores `alt` text and its own `accent` colour.

---

## 4. What the site receives (`content/world.json`)

One array, one object per live project, in grid order:

```json
{
  "type": "video",
  "title": "Dhandho",
  "author": "Buildanta",
  "caption": "Hindi-first books for Indian shops.",
  "show_caption": true,
  "body": "Billing, ledger, stock and staff for a shop that runs in Hindi…",
  "link": "#/work/dhandho",
  "color": "#ec1313",
  "file": "/world/art/placeholder-01.mp4",
  "image_size": [512, 342],
  "gallery": [
    { "type": "image", "file": "/world/art/shot-2.jpg", "image_size": [1200, 900] }
  ]
}
```

The media is **downloaded next to the JSON** at build time, so the live site
never calls Supabase: visitors wait on nothing, and a Supabase outage can't
blank the page. Full sample of all 58: `reference/world.json.sample`.

---

## 5. Run it

Needs: Node 18+, Docker, Supabase CLI.

```bash
supabase start                                  # local database + login + storage
cp .env.example admin/.env.local                # paste the anon key `supabase start` prints
cd admin && npm install && npm run dev          # http://localhost:5300
```

Sign up once — that first account is the owner.

**Build the site's content** (after publishing in the admin):

```bash
(cd admin && npm install)                        # tools reuse admin's supabase-js
export SUPABASE_SERVICE_KEY=...                   # server-side only, NEVER in the browser
node tools/build-content.cjs --out /path/to/site --art world/art
node tools/build-content.cjs --draft --out ...    # preview unpublished edits
```

Writes `<site>/content/world.json`, `<site>/content/site.json` and the media
into `<site>/public/world/art/`.

**Load the current 58 projects into a fresh database:**
`SITE_DIR=/path/to/site node tools/import-world.cjs` (reads `content/world.json`
and `public/` from that folder).

**Tests** (they reset the local DB first, on purpose):
`node tools/verify-rls.cjs` (permissions) · `node tools/verify-admin.cjs`
(full browser flow — needs `npm i -D playwright` inside `admin/`).

Environment variables used by the tools: `SUPABASE_URL` (default
`http://127.0.0.1:54321`), `SUPABASE_SERVICE_KEY`, `ANON_KEY`, `SITE_DIR`,
`CAPTURES_DIR`.

---

## 6. Rules that must not break

1. **Anon key in the browser, service key only on the server.** All security is
   Supabase row-level security, tested by `verify-rls.cjs`.
2. **RLS and GRANT are two separate gates.** Migration 0003 opens the grants.
   Test as a real user, never as `postgres` (a superuser skips both gates).
3. **Roles:** owner (everything, manages people) · editor (edit, upload,
   publish) · viewer (read-only, e.g. to show a client).
4. **Publishing = one frozen snapshot** (`site_snapshots`). The build reads that,
   never the live tables, so a build can't catch half an edit. Rolling back =
   point at an older snapshot.
5. The database itself refuses: external links without a URL, `javascript:`
   links, a live project with no main photo, two "current" snapshots.

---

## 7. Changes made while extracting

- The scripts in `tools/` had paths hard-wired to the old Mac
  (`/Users/buildanta/claude code/...`). They are now relative to this folder,
  or read from `SITE_DIR` / `CAPTURES_DIR`.
- Added `.env.example`.
- Added `reference/` (sample JSON + the site's display code).
- Nothing in `admin/` or `supabase/` was changed.

**Checked on 25 Sep 2026:** clean `npm install` + `npm run build` of `admin/`
passes; the login screen renders with zero console errors; every tool passes
`node --check`. **Not re-run here:** the database suites (they need Docker).
Run `verify-rls.cjs` first when you set it up.
