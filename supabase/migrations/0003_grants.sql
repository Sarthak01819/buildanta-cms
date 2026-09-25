-- Table privileges for the `authenticated` role.
--
-- RLS and GRANT are two different gates and BOTH have to be open.
--
-- 0001 enabled RLS and wrote 11 policies, and the admin still could not read a
-- single row: `permission denied for table members`. A policy filters rows
-- WITHIN a privilege the role already holds — it never grants the privilege.
-- Without this file every policy in 0001 is unreachable.
--
-- This was invisible while testing as `postgres`, because a superuser bypasses
-- both gates. The only way to see it is to run as the role the app actually
-- uses, which is what tools/verify-rls.cjs now does.

-- Content: the app reads and writes; the POLICIES decide which rows.
grant select, insert, update, delete
  on table members, media, projects, project_media, site_content
  to authenticated;

-- Snapshots are read by members and written only by publish_site(), which is
-- SECURITY DEFINER. No insert grant here on purpose: it is the one thing that
-- must not be writable directly, or "exactly one current" becomes a race.
grant select on table site_snapshots to authenticated;

-- Append-only from the client's side: readable, never editable. An audit log a
-- writer can rewrite is not an audit log.
grant select on table audit_log to authenticated;

-- bigserial columns need the sequence too, or an insert fails with a message
-- about the sequence rather than about the table, which is a confusing hour.
grant usage, select on sequence site_snapshots_id_seq to authenticated;
grant usage, select on sequence audit_log_id_seq     to authenticated;

-- service_role: the server-side identity. Used by the publish job, by the build
-- step that reads a snapshot, and by one-off imports — never by a browser.
--
-- It needs an explicit grant for the same reason `authenticated` did: these
-- tables were created by the migration, so nothing has privileges on them until
-- something says so. Without this the world import failed 58 times with
-- `permission denied for table media` while holding the service key, which
-- reads like an auth bug and is not one.
--
-- service_role also BYPASSES RLS (it is marked bypassrls in Supabase), which is
-- exactly why it must never reach a browser: it would make all 11 policies
-- decoration.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- `anon` gets nothing. Nobody browses this data signed-out: the public site is
-- a static build, and the build reads the snapshot server-side with the service
-- key. Anything reachable anonymously here would be a leak with no upside.
revoke all on table members, media, projects, project_media,
                  site_content, site_snapshots, audit_log
  from anon;
