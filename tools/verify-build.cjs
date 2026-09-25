// The build step and preview mode, end to end.
//
// What has to be true: what you PREVIEW is what SHIPS, the built manifest drives
// the real world, and a draft build never touches what visitors see.
const { createClient } = require(require('path').join(__dirname, '../admin/node_modules/@supabase/supabase-js'))
const { execFileSync } = require('child_process')
const fs = require('fs')
const WORLD = (process.env.SITE_DIR || require('path').join(__dirname, '../site-output'))
const path = require('path')
const safeReset = require('./safe-reset.cjs')
require('./local-only.cjs')('verify-build (it runs `supabase db reset`)')


const KEY = process.env.SUPABASE_SERVICE_KEY
const db = createClient('http://127.0.0.1:54321', KEY, { auth: { persistSession: false } })
const results = []
const ok = (n, pass, d = '') => results.push({ n, pass: !!pass, d })
const build = (args) => execFileSync('node',
  [path.join(__dirname, 'build-content.cjs'), ...args], { encoding: 'utf8', env: process.env })

;(async () => {
  // A clean, known state.
  //
  // These checks assert things like "with no edits, preview reports nothing
  // pending", which is only meaningful from a known baseline. Left to inherit
  // whatever the database happens to hold, four of them failed the moment three
  // unpublished edits were made for a screenshot — measuring leftovers, not
  // behaviour. Same lesson as the permission suite.
  console.log('resetting and importing…')
  safeReset('verify-build')
  execFileSync('node', [path.join(__dirname, 'import-world.cjs'), '--write'],
    { stdio: 'ignore', env: process.env })
  execFileSync('node', [path.join(__dirname, 'import-site.cjs'), '--write'],
    { stdio: 'ignore', env: process.env })

  // ---- publish, then build from the snapshot
  const { data: snapId } = await db.rpc('publish_site', { note: 'build verify' })
  const outA = '/tmp/verify-live'
  fs.rmSync(outA, { recursive: true, force: true })
  const logA = build(['--out', outA])
  ok('a published snapshot builds', /58 projects/.test(logA), logA.split('\n')[1]?.trim())

  const live = JSON.parse(fs.readFileSync(`${outA}/content/world.json`, 'utf8'))
  ok('every project reaches the manifest', live.length === 58, `${live.length}`)
  ok('the media is downloaded beside it, not linked',
    fs.readdirSync(`${outA}/public/art`).length === 58 && live.every((i) => i.file.startsWith('/art/')),
    'a built site must not depend on Supabase at runtime')

  // ---- nothing to publish, so preview shows nothing pending
  const { data: c0 } = await db.rpc('preview_changes')
  ok('with no edits, preview reports nothing pending',
    c0.added.length === 0 && c0.changed.length === 0 && c0.removed.length === 0,
    JSON.stringify({ a: c0.added.length, c: c0.changed.length, r: c0.removed.length }))

  // ---- edit something WITHOUT publishing
  //
  // Pick a project that exists rather than one this file remembers. It named
  // `placeholder-24`, which stopped existing the day the placeholders were given
  // real names — the update then matched zero rows and the assertions below
  // compared an edit that had never happened, reporting a diff bug that was not
  // one. A fixture must come from the data, not from memory of it.
  const { data: victimRow } = await db.from('projects')
    .select('slug, title').order('position').limit(1).single()
  const victim = victimRow.slug
  const victimWas = victimRow.title
  await db.from('projects').update({ title: 'EDITED IN DRAFT' }).eq('slug', victim)
  const { data: c1 } = await db.rpc('preview_changes')
  ok('an unpublished edit shows as pending',
    c1.changed.includes('EDITED IN DRAFT'), `changed: ${c1.changed.join(',')}`)

  // ---- the LIVE build must not see it
  const outB = '/tmp/verify-live2'
  fs.rmSync(outB, { recursive: true, force: true })
  build(['--out', outB])
  const liveAfter = JSON.parse(fs.readFileSync(`${outB}/content/world.json`, 'utf8'))
  ok('a live build ignores unpublished edits',
    !liveAfter.some((i) => i.title === 'EDITED IN DRAFT'),
    'visitors must not see a draft')

  // ---- the DRAFT build must see it
  const outC = '/tmp/verify-draft'
  fs.rmSync(outC, { recursive: true, force: true })
  const logC = build(['--draft', '--out', outC])
  const draft = JSON.parse(fs.readFileSync(`${outC}/content/world.json`, 'utf8'))
  ok('a draft build shows unpublished edits',
    draft.some((i) => i.title === 'EDITED IN DRAFT'))
  ok('a draft build says so', /DRAFT/.test(logC))

  // ---- publish, and the draft becomes the live one. What you previewed ships.
  await db.rpc('publish_site', { note: 'after edit' })
  const outD = '/tmp/verify-live3'
  fs.rmSync(outD, { recursive: true, force: true })
  build(['--out', outD])
  const shipped = JSON.parse(fs.readFileSync(`${outD}/content/world.json`, 'utf8'))
  const previewed = draft.map((i) => ({ ...i }))
  ok('WHAT YOU PREVIEWED IS WHAT SHIPS',
    JSON.stringify(shipped) === JSON.stringify(previewed),
    shipped.length === previewed.length ? 'byte-identical' : `${shipped.length} vs ${previewed.length}`)

  // ---- and preview is clean again
  const { data: c2 } = await db.rpc('preview_changes')
  ok('after publishing, nothing is pending',
    c2.changed.length === 0 && c2.added.length === 0 && c2.removed.length === 0)

  // ---- the SITE's own copy, not just the projects
  //
  // Proving the reel renders 9 services proves nothing: the fallback array in
  // services.js holds the same 9. The only honest test is to change something
  // ONLY the CMS knows and watch the build follow it.
  const { data: seoRow } = await db.from('site_content').select('value').eq('key', 'service.seo').single()
  const marker = 'CMS-DRIVEN-' + Math.random().toString(36).slice(2)
  await db.from('site_content').update({ value: { ...seoRow.value, line: marker } }).eq('key', 'service.seo')
  await db.rpc('publish_site', { note: 'site content check' })
  const outE = '/tmp/verify-site'
  fs.rmSync(outE, { recursive: true, force: true })
  build(['--out', outE])
  const site = JSON.parse(fs.readFileSync(`${outE}/content/site.json`, 'utf8'))
  ok('the SITE copy is CMS-driven, not the hardcoded fallback',
    site['service.seo']?.line === marker, 'edited the CMS, the build followed')
  ok('all 9 services reach the build',
    Object.keys(site).filter((k) => k.startsWith('service.')).length === 9,
    `${Object.keys(site).filter((k) => k.startsWith('service.')).length}`)
  ok('the section headings come through too',
    Object.keys(site).filter((k) => k.startsWith('section.')).length === 5)
  // Put it back so a verify run never leaves the site copy edited.
  await db.from('site_content').update({ value: seoRow.value }).eq('key', 'service.seo')
  await db.rpc('publish_site', { note: 'restore' })

  // ---- rebuilding does not re-download
  const logE = build(['--out', outD])
  ok('a rebuild reuses media it already has', /58 already current/.test(logE),
    logE.split('\n').find((l) => /media:/.test(l))?.trim())

  // put the title back so the fixture is not left edited
  await db.from('projects').update({ title: victimWas }).eq('slug', victim)
  await db.rpc('publish_site', { note: 'restore' })

  // The site's own copy, checked as CONTENT and not as "the build exited 0".
  // This suite passed 14/14 while site.json was being written as {}.
  const siteJson = JSON.parse(fs.readFileSync(`${WORLD}/content/site.json`, 'utf8'))
  ok('site.json carries the site copy', Object.keys(siteJson).length > 0,
    `${Object.keys(siteJson).length} keys`)
  ok('the services survived the round trip',
    Object.keys(siteJson).filter((k) => k.startsWith('service.')).length === 9,
    Object.keys(siteJson).filter((k) => k.startsWith('service.')).length + ' services')

  for (const r of results) console.log(`${r.pass ? ' PASS' : ' FAIL'}  ${r.n}${r.d ? '  — ' + r.d : ''}`)
  const bad = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - bad}/${results.length} build + preview checks passed`)
  process.exit(bad ? 1 : 0)
})()
