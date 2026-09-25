-- Buildanta CMS — schema and auth.
--
-- Decisions this implements (11 Aug 2026): a real CMS with logins, for Yash and
-- the team, covering the WHOLE site; media in storage behind a CDN; content
-- delivered at BUILD time with a live preview for editors.
--
-- Read docs/SCHEMA.md for why it is shaped this way. The short version: editors
-- always work on live rows, and publishing writes ONE immutable snapshot of the
-- entire site that the build reads. That is what makes a build-time site safe to
-- edit — there is no moment where half the site is new and half is old.

-- ---------------------------------------------------------------- extensions
create extension if not exists "pgcrypto";      -- gen_random_uuid()

-- ---------------------------------------------------------------- roles
--
-- Three, deliberately. More roles than a team can name is a permission model
-- nobody applies correctly.
--   owner   — everything, including managing members. Yash.
--   editor  — write content, upload media, publish.
--   viewer  — read the admin, publish nothing. For a client being shown work.
create type member_role as enum ('owner', 'editor', 'viewer');

create table members (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        member_role not null default 'viewer',
  full_name   text,
  created_at  timestamptz not null default now()
);

comment on table members is
  'Who may use the admin. A row here IS the grant — auth.users alone means nothing.';

-- ---------------------------------------------------------------- media
--
-- Files live in Supabase Storage; this table is the catalogue.
--
-- width and height are NOT decoration. The world builds each card''s geometry
-- from the declared size, not from the file, so a 16:9 photo dropped into a slot
-- declared 512x512 is silently squashed. Yash chose auto-fit: the admin reads
-- the real dimensions on upload and writes them here, and the card reshapes to
-- the art. Storing them also lets the build emit width/height on every <img>,
-- which is what stops the page jumping as images decode.
create table media (
  id            uuid primary key default gen_random_uuid(),
  storage_path  text not null unique,
  kind          text not null check (kind in ('image', 'video')),
  mime          text not null,
  width         integer not null check (width > 0),
  height        integer not null check (height > 0),
  bytes         bigint  not null check (bytes > 0),
  -- Derived from the image on upload (the same mean-hue method the world's
  -- tools use) and overridable by an editor, per Yash's choice.
  accent        text check (accent ~ '^#[0-9a-fA-F]{6}$'),
  alt           text,
  uploaded_by   uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create index media_kind_idx on media (kind);

-- ---------------------------------------------------------------- projects
--
-- The 58 the world renders, and anything added later.

-- Where clicking the photograph takes you. Yash: he wants to paste links to
-- projects that live somewhere else — a client's own site, a case study, a
-- Behance post — without every card being forced through a page we host.
--   internal — the project page this CMS generates (the default)
--   external — a URL he pastes; opens in a new tab
--   none     — the card opens in the world but goes nowhere further
create type project_link_mode as enum ('internal', 'external', 'none');
create table projects (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title         text not null,
  author        text not null default 'Buildanta',
  caption       text,
  show_caption  boolean not null default false,
  -- The card''s own colour. Auto-derived from the media, editable.
  accent        text not null check (accent ~ '^#[0-9a-fA-F]{6}$'),
  card_media    uuid references media(id) on delete restrict,
  body          text,

  -- The click target.
  link_mode     project_link_mode not null default 'internal',
  link_url      text,
  -- An external card without a URL is a dead link that looks alive, which is
  -- the failure the world already guards against by hiding its CTA. The
  -- database refuses the state outright rather than trusting the form.
  constraint external_link_needs_url check (
    link_mode <> 'external' or (link_url is not null and link_url ~ '^https?://')
  ),

  -- Where it sits in the grid. Sparse on purpose (10, 20, 30…) so a reorder is
  -- one UPDATE rather than renumbering the whole table.
  position      integer not null default 0,
  is_live       boolean not null default true,
  -- A live project with no card image is a hole in the grid — the world builds
  -- a card for it and has nothing to put on it. Caught here rather than in the
  -- admin, because the admin is not the only thing that will ever write.
  constraint live_needs_a_card check (not is_live or card_media is not null),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index projects_position_idx on projects (position) where is_live;

comment on column projects.card_media is
  'ON DELETE RESTRICT, not CASCADE: deleting a file must never silently delete
   the project that showed it. The admin has to unpick it deliberately.';

-- A project''s gallery. Ordered, and a file may appear in more than one.
create table project_media (
  project_id  uuid not null references projects(id) on delete cascade,
  media_id    uuid not null references media(id)    on delete cascade,
  position    integer not null default 0,
  primary key (project_id, media_id)
);

-- ---------------------------------------------------------------- site copy
--
-- Everything on the site that is not a project: intro copy, services, contact.
--
-- Key/value with a JSONB value rather than a column per field. That copy lives
-- in a hand-built WebGL intro whose shape changes with the design; a rigid table
-- would need a migration every time a section gains a line, and the migration
-- would land after the design did.
create table site_content (
  key         text primary key check (key ~ '^[a-z0-9_.-]+$'),
  section     text not null,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

create index site_content_section_idx on site_content (section);

-- ---------------------------------------------------------------- snapshots
--
-- What the BUILD reads. One row, one whole site, immutable.
--
-- The alternative — the build querying projects and site_content directly —
-- means a build that starts mid-edit ships half of one version and half of
-- another, and nothing in the output says so. A snapshot is taken at a single
-- instant, so a deploy is always internally consistent and always reproducible:
-- the same snapshot id rebuilds the same site a month later.
create table site_snapshots (
  id           bigserial primary key,
  payload      jsonb not null,
  published_by uuid references auth.users(id),
  note         text,
  is_current   boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Exactly one current snapshot, enforced by the DATABASE rather than by
-- whichever code path happens to run last. A partial unique index on a constant
-- allows any number of false rows and exactly one true.
create unique index site_snapshots_one_current
  on site_snapshots ((true)) where is_current;

-- ---------------------------------------------------------------- updated_at
create or replace function touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch before update on projects
  for each row execute function touch_updated_at();
create trigger site_content_touch before update on site_content
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- helpers
--
-- SECURITY DEFINER so a policy can read `members` without the caller needing
-- read access to it, and `search_path` pinned so the function cannot be
-- hijacked by a caller-controlled schema.
create or replace function current_role_is(allowed member_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from members
    where user_id = auth.uid() and role = any(allowed)
  );
$$;

-- ⚠️ Postgres grants EXECUTE on new functions to PUBLIC by default. Left alone,
-- anonymous visitors can call these. Learned the hard way on the sales-agent
-- stack, where an agent could self-grant its own consent that way.
revoke execute on function current_role_is(member_role[]) from public;
grant  execute on function current_role_is(member_role[]) to authenticated;

revoke execute on function touch_updated_at() from public;

-- ---------------------------------------------------------------- RLS
--
-- ⚠️ RLS is only real if the app connects as a NON-owner role. The table owner
-- bypasses every policy, so a connection string with the owner or the service
-- key makes all of this decoration — which is exactly what happened on Dhandho
-- v2 in production, where 26 policies were doing nothing.
-- The app connects as `authenticated` via the anon key. The service key is used
-- ONLY by the publish job, never by the admin UI, and never in a browser.

alter table members       enable row level security;
alter table media         enable row level security;
alter table projects      enable row level security;
alter table project_media enable row level security;
alter table site_content  enable row level security;
alter table site_snapshots enable row level security;

-- members: everyone signed in can see who is on the team; only an owner writes.
create policy members_read on members
  for select to authenticated
  using (current_role_is(array['owner','editor','viewer']::member_role[]));

create policy members_write on members
  for all to authenticated
  using      (current_role_is(array['owner']::member_role[]))
  with check (current_role_is(array['owner']::member_role[]));

-- content: any member reads; editors and owners write.
create policy media_read on media
  for select to authenticated
  using (current_role_is(array['owner','editor','viewer']::member_role[]));
create policy media_write on media
  for all to authenticated
  using      (current_role_is(array['owner','editor']::member_role[]))
  with check (current_role_is(array['owner','editor']::member_role[]));

create policy projects_read on projects
  for select to authenticated
  using (current_role_is(array['owner','editor','viewer']::member_role[]));
create policy projects_write on projects
  for all to authenticated
  using      (current_role_is(array['owner','editor']::member_role[]))
  with check (current_role_is(array['owner','editor']::member_role[]));

create policy project_media_read on project_media
  for select to authenticated
  using (current_role_is(array['owner','editor','viewer']::member_role[]));
create policy project_media_write on project_media
  for all to authenticated
  using      (current_role_is(array['owner','editor']::member_role[]))
  with check (current_role_is(array['owner','editor']::member_role[]));

create policy site_content_read on site_content
  for select to authenticated
  using (current_role_is(array['owner','editor','viewer']::member_role[]));
create policy site_content_write on site_content
  for all to authenticated
  using      (current_role_is(array['owner','editor']::member_role[]))
  with check (current_role_is(array['owner','editor']::member_role[]));

-- snapshots: members read (so preview can diff against what is live).
-- NOBODY inserts from the client — publishing goes through the function below,
-- which is the only way to keep "exactly one current" true.
create policy snapshots_read on site_snapshots
  for select to authenticated
  using (current_role_is(array['owner','editor','viewer']::member_role[]));

-- ---------------------------------------------------------------- publish
--
-- Builds the whole site into one row and marks it current, atomically.
create or replace function publish_site(note text default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id bigint;
  doc    jsonb;
begin
  -- A member with write rights, OR the server itself.
  --
  -- service_role has no auth.uid(), so the membership check correctly refuses
  -- it — right for a person, wrong for the deploy pipeline, which publishes
  -- with the service key and has no user to be.
  --
  -- Read from the JWT claims, NOT from current_user. This function is SECURITY
  -- DEFINER, so inside it current_user is the function's OWNER (postgres) and
  -- never the caller — a check against it can never see service_role and
  -- silently refuses the one identity it was meant to allow.
  if coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') <> 'service_role'
     and not current_role_is(array['owner','editor']::member_role[]) then
    raise exception 'not permitted to publish';
  end if;

  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(p order by p.position, p.created_at)
      from (
        select
          pr.slug, pr.title, pr.author, pr.caption, pr.show_caption,
          pr.accent, pr.body, pr.position,
          -- Selected so the ORDER BY below can use it. Position is sparse and
          -- hand-set, so two projects can share one; created_at breaks the tie
          -- deterministically, which is what stops the grid reshuffling between
          -- two publishes that changed nothing.
          pr.created_at,
          pr.link_mode,
          -- Resolved here, once, so the site never has to decide. An internal
          -- card gets the hash route the world already understands; an external
          -- one gets the pasted URL; 'none' gets null and the card simply is
          -- not a link.
          case pr.link_mode
            when 'internal' then '#/work/' || pr.slug
            when 'external' then pr.link_url
            else null
          end as link,
          -- The card's file AND its true pixel size travel together. The world
          -- builds card geometry from these numbers, so a payload carrying one
          -- without the other is what squashes art.
          jsonb_build_object(
            'path',   m.storage_path,
            'kind',   m.kind,
            'width',  m.width,
            'height', m.height,
            'alt',    m.alt
          ) as card,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'path', gm.storage_path, 'kind', gm.kind,
              'width', gm.width, 'height', gm.height, 'alt', gm.alt
            ) order by pm.position)
            from project_media pm join media gm on gm.id = pm.media_id
            where pm.project_id = pr.id
          ), '[]'::jsonb) as gallery
        from projects pr
        left join media m on m.id = pr.card_media
        where pr.is_live
      ) p
    ), '[]'::jsonb),
    'site', coalesce((
      select jsonb_object_agg(key, value) from site_content
    ), '{}'::jsonb),
    'published_at', now()
  ) into doc;

  update site_snapshots set is_current = false where is_current;
  insert into site_snapshots (payload, published_by, note, is_current)
  values (doc, auth.uid(), note, true)
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function publish_site(text) from public;
grant  execute on function publish_site(text) to authenticated;

-- ---------------------------------------------------------------- audit
--
-- The team answer made this necessary: with more than one person editing, "who
-- changed the homepage copy" has to be answerable.
create table audit_log (
  id         bigserial primary key,
  actor      uuid references auth.users(id),
  action     text not null,
  entity     text not null,
  entity_id  text,
  diff       jsonb,
  at         timestamptz not null default now()
);

alter table audit_log enable row level security;

-- Append-only from the client's point of view: members read, nobody updates or
-- deletes. An audit log a writer can edit is not an audit log.
create policy audit_read on audit_log
  for select to authenticated
  using (current_role_is(array['owner','editor','viewer']::member_role[]));

create index audit_at_idx on audit_log (at desc);
