-- Tell a rename apart from a deletion.
--
-- The diff matched projects by slug, so renaming 12 placeholders read as
-- "Removed 12" in red beside "New 12" — on a screen whose whole job is to say
-- what publishing will do. Nothing was being removed. A publish screen that
-- cries deletion is worse than no publish screen, because the one time it
-- really is a deletion nobody will believe it.
--
-- A slug is an address, not an identity. Matching on it means any project that
-- moves address looks like a different project. The row id is the identity, so
-- the payload has to carry it.

-- 1. The payload gains the project id.
--
-- It stays inside the snapshot: build-content.cjs maps a fixed set of fields
-- into world.json and the id is not one of them, so nothing about the public
-- site changes.
create or replace function build_payload()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(p order by p.position, p.created_at)
      from (
        select
          pr.id,
          pr.slug, pr.title, pr.author, pr.caption, pr.show_caption,
          pr.accent, pr.body, pr.position, pr.created_at,
          pr.link_mode,
          case pr.link_mode
            when 'internal' then '#/work/' || pr.slug
            when 'external' then pr.link_url
            else null
          end as link,
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
        where pr.is_live and pr.card_media is not null
        order by pr.position, pr.created_at
      ) p
    ), '[]'::jsonb),
    -- 'site', not 'content'. build-content.cjs reads payload.site and writes
    -- content/site.json from it; renaming this key while rewriting the function
    -- for the id change silently emptied the site's own copy out of every build
    -- — no error, just site.json written as {}. The shape of a function's output
    -- is part of its contract even when nothing type-checks it.
    'site', coalesce((
      select jsonb_object_agg(key, value) from site_content
    ), '{}'::jsonb)
  );
$$;
revoke execute on function build_payload() from public;
grant  execute on function build_payload() to authenticated, service_role;

-- 2. The diff, in four buckets instead of three.
create or replace function preview_changes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  draft jsonb := build_payload()->'projects';
  live  jsonb := coalesce(
    (select payload->'projects' from site_snapshots where is_current), '[]'::jsonb);
  by_id boolean;
  out   jsonb;
begin
  -- Snapshots published before this migration carry no id. Matching those by id
  -- would call every single project both added and removed — the exact alarm
  -- this change exists to remove, made worse. Fall back to the old slug match
  -- for them; the first publish after this writes ids and it never applies again.
  by_id := jsonb_array_length(live) = 0
        or exists (select 1 from jsonb_array_elements(live) e where e ? 'id');

  with d as (
    select case when by_id then e->>'id' else e->>'slug' end as k,
           e->>'slug' as slug, e->>'title' as title, e as p
    from jsonb_array_elements(draft) e
  ),
  l as (
    select case when by_id then e->>'id' else e->>'slug' end as k,
           e->>'slug' as slug, e->>'title' as title, e as p
    from jsonb_array_elements(live) e
  )
  select jsonb_build_object(
    'has_published', exists (select 1 from site_snapshots where is_current),
    'added',   coalesce((select jsonb_agg(d.title) from d left join l using (k) where l.k is null), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(l.title) from l left join d using (k) where d.k is null), '[]'::jsonb),
    -- Same project, different address.
    'renamed', coalesce((
      select jsonb_agg(l.title || ' → ' || d.title)
      from d join l using (k) where d.slug is distinct from l.slug
    ), '[]'::jsonb),
    -- Content edits only. A project whose address moved is reported as a
    -- rename and not also as an edit: a rename necessarily changes the title,
    -- so counting both would show every rename twice.
    --
    -- `id` is stripped alongside `created_at` for the same reason created_at
    -- was — comparing a draft that has one against a snapshot that does not
    -- would mark all 58 as edited, once, for no reason a reader could see.
    'changed', coalesce((
      select jsonb_agg(d.title) from d join l using (k)
      where d.slug is not distinct from l.slug
        and (d.p - 'created_at' - 'id') is distinct from (l.p - 'created_at' - 'id')
    ), '[]'::jsonb),
    'draft_count', (select count(*) from d),
    'live_count',  (select count(*) from l)
  ) into out;

  return out;
end;
$$;
revoke execute on function preview_changes() from public;
grant  execute on function preview_changes() to authenticated, service_role;
