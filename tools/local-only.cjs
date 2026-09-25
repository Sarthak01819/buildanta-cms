// A destructive script must refuse a database that isn't on this machine.
//
// Five tools in here either wipe the database (`supabase db reset`) or
// overwrite every project in it (`--write`). All five read the target from
// SUPABASE_URL and quietly default to localhost — so the day this CMS is
// pointed at the real Supabase project, one shell that still has SUPABASE_URL
// exported from an earlier command turns `node tools/import-world.cjs --write`
// into "replace the live site's 58 projects with the fallback copy". Nothing
// would ask, and nothing would say it had happened.
//
// The .env of a project usually points at production for convenience. That is
// exactly why the refusal has to live in the script and not in the operator's
// memory.
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/

module.exports = function localOnly(what) {
  const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
  if (LOOPBACK.test(url)) return url

  console.error(`\n  REFUSED — ${what} is destructive and this is not a local database.`)
  console.error(`  SUPABASE_URL = ${url}`)
  console.error(`\n  Unset it, or point it at http://127.0.0.1:54321.`)
  console.error(`  If you genuinely mean to write to that database, do it from`)
  console.error(`  the admin, which goes through the permission rules.\n`)
  process.exit(1)
}
