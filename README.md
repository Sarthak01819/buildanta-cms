# Buildanta CMS

A real admin for the Buildanta site: log in, edit projects, upload media,
publish. Supabase for database, auth and storage; the admin is a static SPA.

## Run it

```bash
supabase start                 # local Postgres + auth + storage
cd admin && npm install && npm run dev      # http://localhost:5300
```

The first account you create becomes the **owner**. Everyone after lands as a
**viewer** until an owner promotes them — so an unnoticed signup can never grant
itself write access.

## Verify it

```bash
node tools/verify-rls.cjs      # permissions, as the role the app actually uses
node tools/verify-admin.cjs    # the whole flow in a browser
```

Both reset the database first. They have to: the first account ever created
becomes owner, so a second run without a reset signs in as a viewer and every
write fails for a reason that has nothing to do with the code.

## Why the admin has no backend of its own

There is no server between the browser and Supabase. Every permission is RLS,
evaluated against the signed-in user. That is only safe if it is actually
tested, which is what `verify-rls.cjs` is for — it drives the REST API with a
real token instead of trusting the policies to be right.

The anon key ships in the browser by design; it identifies the project and
grants nothing. `src/supabase.js` throws if it is ever handed a service key.

## The build step

The site is delivered at BUILD time: visitors get static files and never wait on
a database, and a Supabase outage cannot blank the page.

```bash
node tools/build-content.cjs             # the published snapshot
node tools/build-content.cjs --draft     # unpublished edits, to preview
```

It writes `content/world.json` and **downloads the media beside it**, so the
built site has no runtime dependency on Supabase at all. That is also what keeps
the single-file preview possible — it inlines every asset, and it cannot inline
a remote URL. A rebuild reuses files it already has.

## Preview

The Publish screen shows what would change — added, edited, removed, by slug —
computed by the SAME function that builds the payload. Two copies of that query
would drift, and the day they drift is the day preview shows something the build
does not produce.

Verified byte-for-byte: edit without publishing, build `--draft`, publish, build
live, and the two manifests are identical. What you preview is what ships.

## The trap this build already hit

RLS and GRANT are two different gates and both must be open. 0001 enabled RLS
and wrote 11 policies, and the admin still could not read one row —
`permission denied for table members`. A policy filters rows within a privilege
the role already has; it never grants the privilege. 0003 does that.

It was invisible while testing as `postgres`, because a superuser bypasses both
gates. Testing as the owner proves nothing about what a real user can do.
