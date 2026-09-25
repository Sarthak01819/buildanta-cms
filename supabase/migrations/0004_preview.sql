-- Preview: see what WOULD publish, without publishing.
--
-- The payload builder moves into its own function and both callers use it.
-- Two copies of that query would drift — and the day they drift is the day
-- preview shows something the build does not produce, which is worse than
-- having no preview at all.

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
        where pr.is_live
      ) p
    ), '[]'::jsonb),
    'site', coalesce((
      select jsonb_object_agg(key, value) from site_content
    ), '{}'::jsonb)
  );
$$;

revoke execute on function build_payload() from public;
grant  execute on function build_payload() to authenticated, service_role;

-- publish_site now stores what build_payload produced, so what you previewed is
-- byte-for-byte what ships (bar the timestamp).
create or replace function publish_site(note text default null)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id bigint;
begin
  if coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') <> 'service_role'
     and not current_role_is(array['owner','editor']::member_role[]) then
    raise exception 'not permitted to publish';
  end if;

  update site_snapshots set is_current = false where is_current;
  insert into site_snapshots (payload, published_by, note, is_current)
  values (build_payload() || jsonb_build_object('published_at', now()),
          auth.uid(), note, true)
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function publish_site(text) from public;
grant  execute on function publish_site(text) to authenticated, service_role;

-- What changed since the last publish.
--
-- Counts and a per-project verdict, not a full diff: the question an editor
-- actually has is "is there anything to publish, and what will move", and a
-- character-level diff of a JSONB blob answers a question nobody asked.
create or replace function preview_changes()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with draft as (
    select jsonb_array_elements(build_payload()->'projects') as p
  ),
  live as (
    select jsonb_array_elements(payload->'projects') as p
    from site_snapshots where is_current
  ),
  d as (select p->>'slug' as slug, p from draft),
  l as (select p->>'slug' as slug, p from live)
  select jsonb_build_object(
    'has_published', exists (select 1 from site_snapshots where is_current),
    'added',   coalesce((select jsonb_agg(d.slug) from d left join l using (slug) where l.slug is null), '[]'::jsonb),
    'removed', coalesce((select jsonb_agg(l.slug) from l left join d using (slug) where d.slug is null), '[]'::jsonb),
    -- Compared with published_at stripped, or every project would look changed
    -- the moment anything was published.
    'changed', coalesce((
      select jsonb_agg(d.slug) from d join l using (slug)
      where (d.p - 'created_at') is distinct from (l.p - 'created_at')
    ), '[]'::jsonb),
    'draft_count', (select count(*) from d),
    'live_count',  (select count(*) from l)
  );
$$;

revoke execute on function preview_changes() from public;
grant  execute on function preview_changes() to authenticated, service_role;
