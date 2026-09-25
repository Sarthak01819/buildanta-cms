// Permissions, tested as the ROLE THE APP USES.
//
// Every check in this file failed to exist for a while, and that is the point:
// the SQL suite ran as `postgres`, a superuser, which bypasses both GRANT and
// RLS. It reported everything green while the admin could not read one row.
// These calls go through PostgREST with a real signed-in user's token, exactly
// as the browser does.
const { execFileSync } = require('child_process')
const safeReset = require('./safe-reset.cjs')

const API = 'http://127.0.0.1:54321'
const ANON = process.env.ANON_KEY
const results = []
const ok = (n, pass, d = '') => results.push({ n, pass: !!pass, d })

// psql appends its own status line after a RETURNING value, so an id comes
// back with 'INSERT 0 1' stuck to it and is not a uuid at all. Take line one.
const sql = (q) => execFileSync('docker',
  ['exec', 'supabase_db_buildanta-cms', 'psql', '-U', 'postgres', '-t', '-A', '-q', '-c', q])
  .toString().trim().split(String.fromCharCode(10))[0].trim()

async function signUp(email) {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' })
  })
  const j = await r.json()
  return j.access_token
}

const rest = (token, path, init = {}) => fetch(`${API}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init.headers || {})
  }
})

;(async () => {
  // A clean database every run.
  //
  // Without this the suite is not isolated: the FIRST account ever created
  // becomes owner, so on a second run the "owner" it signs up is really a
  // viewer, and three checks fail for a reason that has nothing to do with the
  // code. A permission test has to start from a known state or it measures
  // history instead of behaviour.
  console.log('resetting the database…')
  safeReset('verify-rls')

  const stamp = Date.now()
  const ownerTok  = await signUp(`owner${stamp}@buildanta.test`)
  const viewerTok = await signUp(`viewer${stamp}@buildanta.test`)

  ok('an owner and a viewer can both sign up', !!ownerTok && !!viewerTok)

  // The first account ever created is the owner; everyone after is a viewer.
  // Read the roles directly rather than through the single-line sql() helper.
  const ownerCount  = sql(`select count(*) from members where role = 'owner'`)
  const viewerCount = sql(`select count(*) from members where role = 'viewer'`)
  ok('the first member is owner, later ones are viewers',
    ownerCount === '1' && viewerCount === '1', `${ownerCount} owner, ${viewerCount} viewer`)

  // ---- reading
  const rOwner = await rest(ownerTok, 'projects?select=id')
  ok('a member can READ (the GRANT that was missing)', rOwner.status === 200, `HTTP ${rOwner.status}`)

  // ---- signed out reads nothing
  const rAnon = await fetch(`${API}/rest/v1/projects?select=id`, { headers: { apikey: ANON } })
  ok('signed OUT can read nothing', rAnon.status !== 200, `HTTP ${rAnon.status}`)

  // ---- an editor/owner may write
  const mediaId = sql(`insert into media (storage_path,kind,mime,width,height,bytes)
    values ('t/${stamp}.jpg','image','image/jpeg',800,400,1000) returning id`)
  const wOwner = await rest(ownerTok, 'projects', {
    method: 'POST',
    body: JSON.stringify({ slug: `owner-${stamp}`, title: 'By owner', accent: '#112233',
      card_media: mediaId, is_live: true })
  })
  ok('an owner can WRITE', wOwner.status === 201,
    wOwner.status === 201 ? '' : `HTTP ${wOwner.status} — ${(await wOwner.text()).slice(0,200)}`)

  // ---- a viewer may NOT write. This is the whole role model in one call.
  const wViewer = await rest(viewerTok, 'projects', {
    method: 'POST',
    body: JSON.stringify({ slug: `viewer-${stamp}`, title: 'By viewer', accent: '#112233' })
  })
  ok('a VIEWER is refused a write', wViewer.status >= 400, `HTTP ${wViewer.status}`)

  // ---- a viewer may still read
  const rViewer = await rest(viewerTok, 'projects?select=id')
  ok('a viewer can still read', rViewer.status === 200, `HTTP ${rViewer.status}`)

  // ---- nobody writes snapshots directly, whatever their role
  const sInsert = await rest(ownerTok, 'site_snapshots', {
    method: 'POST', body: JSON.stringify({ payload: {}, is_current: true })
  })
  ok('nobody inserts a snapshot directly, even an owner', sInsert.status >= 400, `HTTP ${sInsert.status}`)

  // ---- publishing works through the function
  const pub = await rest(ownerTok, 'rpc/publish_site', {
    method: 'POST', body: JSON.stringify({ note: 'rls test' })
  })
  ok('an owner can publish through the function', pub.status === 200, `HTTP ${pub.status}`)

  // ---- and a viewer cannot
  const pubV = await rest(viewerTok, 'rpc/publish_site', {
    method: 'POST', body: JSON.stringify({ note: 'nope' })
  })
  ok('a viewer cannot publish', pubV.status >= 400, `HTTP ${pubV.status}`)

  for (const r of results) console.log(`${r.pass ? ' PASS' : ' FAIL'}  ${r.n}${r.d ? '  — ' + r.d : ''}`)
  const bad = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - bad}/${results.length} permission checks passed`)
  process.exit(bad ? 1 : 0)
})()
