-- Storage: where the actual files live.
--
-- 0001 created the media CATALOGUE (paths, dimensions, accents). This creates
-- the bucket those paths point into, and the policies on it.
--
-- Public read, member-only write. The images are the studio's published work —
-- they are meant to be seen, and a signed URL per card would mean the site
-- cannot be a static build (every URL would expire). Writes are members only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  -- 50 MB. The world's video slots are ~2 MB each and images far less; this is
  -- generous enough for a raw upload and small enough that a mistaken 4K master
  -- is refused rather than silently costing bandwidth on every visit.
  52428800,
  array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read: the site is static and public.
create policy "media public read"
  on storage.objects for select
  using (bucket_id = 'media');

-- Only members with write rights may upload, replace or delete.
create policy "media member write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and current_role_is(array['owner','editor']::member_role[])
  );

create policy "media member update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'media'
    and current_role_is(array['owner','editor']::member_role[])
  );

create policy "media member delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and current_role_is(array['owner','editor']::member_role[])
  );

-- ---------------------------------------------------------------- first owner
--
-- The bootstrap problem: members gates the admin, and only an owner can write
-- members — so a fresh database has no way in.
--
-- This makes the FIRST person to sign up the owner, and only ever the first.
-- Everyone after them lands as a viewer and an owner promotes them, which means
-- an unnoticed public signup cannot quietly grant itself write access.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into members (user_id, role, full_name)
  values (
    new.id,
    case when (select count(*) from members) = 0 then 'owner' else 'viewer' end::member_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$;

revoke execute on function handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
