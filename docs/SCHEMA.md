# Schema and auth — Buildanta CMS

Decided 11 Aug 2026. `supabase/migrations/0001_init.sql` is the implementation;
this is why it looks like that.

Every claim below was run against a real Postgres 16, not reasoned about. The
migration applies clean from an empty schema and the constraints were each
tested by trying to violate them.

## The shape

```
members ──────── who may use the admin (owner / editor / viewer)
media ────────── the file catalogue: path, kind, WIDTH, HEIGHT, accent
projects ─────── the 58, plus link_mode / link_url
project_media ── each project's gallery, ordered
site_content ─── everything that is not a project (intro, services, contact)
site_snapshots ─ what the BUILD reads: one row, the whole site, immutable
audit_log ────── who changed what
```

## Why a snapshot, and not "the build queries the tables"

The site is delivered at build time. If the build read `projects` directly, a
build that starts while someone is mid-edit ships half of one version and half
of another, and nothing in the output says so.

`publish_site()` assembles the entire site into one JSONB row and flips it
current, in one transaction. So:

- a deploy is always internally consistent
- a deploy is reproducible — the same snapshot id rebuilds the same site next
  month, which is what makes a rollback a one-line change
- the build makes ONE query, not a dozen

"Exactly one current" is a partial unique index on a constant, so the database
refuses a second current row rather than trusting whichever code path ran last.
Verified: the second insert errors.

## Why `width` and `height` live on every media row

Card geometry in the world is built from the DECLARED size, not from the file.
Hand it a 16:9 photo for a slot declared 512×512 and the art is silently
squashed — this has already happened once.

Yash chose **auto-fit**: the admin reads the real dimensions on upload and
writes them here, so the card reshapes to the art instead. The same numbers let
the build emit `width`/`height` on every `<img>`, which is what stops the page
jumping as images decode.

The publish payload carries the file path and its size **together**, because a
payload with one and not the other is exactly how art gets squashed.

## The click target — `link_mode`

Yash wants to paste links to work that lives elsewhere.

| mode | what the card links to |
|---|---|
| `internal` | `#/work/<slug>` — the project page this CMS generates. Default. |
| `external` | the URL he pastes. Opens in a new tab. |
| `none` | nothing. The card opens in the world and goes no further. |

Resolved once, inside `publish_site`, so the site never has to decide.

Two things the database refuses outright rather than trusting a form:

- `external` with no URL — a dead link that looks alive is the exact failure the
  world already guards against by hiding its CTA
- a URL that is not `http(s)` — tested with `javascript:alert(1)`, refused

## Roles

Three, because a permission model with more roles than the team can name is one
nobody applies correctly.

| role | can |
|---|---|
| `owner` | everything, including managing members |
| `editor` | write content, upload media, publish |
| `viewer` | read the admin. Publishes nothing. For showing a client. |

A row in `members` **is** the grant. A Supabase auth user with no row can sign in
and see nothing.

## The three Supabase traps this is built against

All three cost us real time before.

**1. RLS is decoration if the app connects as the owner.**
The table owner bypasses every policy. Dhandho v2 ran in production with 26
policies doing nothing for exactly this reason. The admin connects as
`authenticated` through the anon key. The service key is used only by the
publish job — never in a browser, never in the admin.

**2. Postgres grants EXECUTE on new functions to PUBLIC.**
Left alone, an anonymous visitor can call them. On the sales-agent stack that
let an agent self-grant its own consent. Every function here is explicitly
revoked from `public` and granted to `authenticated`. Verified: all three report
`has_function_privilege('public', …) = false`.

**3. The SQL editor needs a click to mount Monaco before it will run anything,
and pasted SQL can silently not be there.** Verify by row count after any manual
run, never by the editor looking right.

`SECURITY DEFINER` functions pin `search_path = public, pg_temp` so a caller
cannot hijack them with their own schema.

## What was tested

| | |
|---|---|
| migration applies clean from empty | yes |
| external link with no URL | refused |
| `javascript:` URL | refused |
| two current snapshots | refused |
| live project with no card image | refused |
| RLS enabled | all 7 tables |
| functions callable by PUBLIC | none of ours |
| publish payload | internal → `#/work/slug`, external → pasted URL, none → null, each with its true pixel size |

One bug was found this way and would otherwise have failed on the first publish
in production: `publish_site` ordered by a column its own subquery never
selected.

## Not done yet

- the admin UI itself
- Storage buckets and their policies (files, as opposed to the catalogue)
- migrating the existing 58 out of `content/world.json` into these tables
- the build step that reads the current snapshot
- preview mode
