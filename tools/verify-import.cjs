// Does the CMS reproduce the world, exactly?
//
// A migration that lands 58 rows has proven nothing. What matters is whether
// publishing them yields the same content the world renders today — same
// titles, same accents, same links, same shapes, same order.
const { createClient } = require(require('path').join(__dirname, '../admin/node_modules/@supabase/supabase-js'))
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const safeReset = require('./safe-reset.cjs')
require('./local-only.cjs')('verify-import (it runs `supabase db reset`)')


const WORLD = (process.env.SITE_DIR || require('path').join(__dirname, '../site-output'))
const db = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const results = []
const ok = (n, pass, d = '') => results.push({ n, pass: !!pass, d })

;(async () => {
  // Own the state. This suite used to run against whatever the database
  // happened to hold, and the last thing to touch it was another suite that
  // resets and leaves ONE project behind. Every "0 differ" below was then
  // comparing an empty set and reporting a pass.
  const root = path.join(__dirname, '..')
  console.log('resetting and re-importing…')
  safeReset('verify-import')
  execFileSync('node', ['tools/import-world.cjs', '--write'], { cwd: root, stdio: 'ignore' })
  execFileSync('node', ['tools/import-site.cjs', '--write'], { cwd: root, stdio: 'ignore' })

  const original = JSON.parse(fs.readFileSync(`${WORLD}/content/world.json`, 'utf8'))

  const { data: snapId, error: pErr } = await db.rpc('publish_site', { note: 'import check' })
  if (pErr) { console.log('publish failed:', pErr.message); process.exit(1) }
  const { data: snap } = await db.from('site_snapshots').select('payload').eq('id', snapId).single()
  const published = snap.payload.projects

  ok('every project published', published.length === original.length,
    `${published.length} of ${original.length}`)

  // Order has to survive. The grid reads them in sequence, so a reshuffle is a
  // different site even with identical content.
  const sameOrder = published.every((p, i) => p.slug === (original[i].link || '').split('/').pop())
  ok('the order is preserved', sameOrder)

  const byslug = Object.fromEntries(published.map((p) => [p.slug, p]))
  let titles = 0, accents = 0, links = 0, sizes = 0, kinds = 0, compared = 0
  const sizeNotes = []

  for (const o of original) {
    const slug = (o.link || '').split('/').pop()
    const p = byslug[slug]
    if (!p) continue
    compared++
    if (p.title !== o.title) titles++
    if ((p.accent || '').toLowerCase() !== (o.color || '').toLowerCase()) accents++
    if (p.link !== o.link) links++
    if (p.card?.kind !== o.type) kinds++
    // Aspect, not exact pixels: five videos differ by one pixel because the
    // encoder rounds to even, and the CMS deliberately took the file's truth.
    const da = o.image_size[0] / o.image_size[1]
    const ra = p.card.width / p.card.height
    if (Math.abs(da - ra) / da > 0.01) { sizes++; sizeNotes.push(`${slug} ${da.toFixed(3)}->${ra.toFixed(3)}`) }
  }

  // Guard the guards: "0 differ" out of 0 rows is not a match, it is an empty
  // loop. Every count below is only meaningful once this passes.
  ok('every project was actually compared', compared === original.length,
    `${compared} of ${original.length} compared`)
  ok('titles match', titles === 0, `${titles} differ`)
  ok('accents match', accents === 0, `${accents} differ`)
  ok('links match', links === 0, `${links} differ`)
  ok('image / video kinds match', kinds === 0, `${kinds} differ`)
  ok('every card keeps its aspect ratio', sizes === 0, sizeNotes.slice(0, 3).join(', '))

  // The files themselves have to be reachable, or the site publishes rows
  // pointing at nothing.
  const sample = published.slice(0, 5)
  let reachable = 0
  for (const p of sample) {
    const url = `${process.env.SUPABASE_URL || 'http://127.0.0.1:54321'}/storage/v1/object/public/media/${p.card.path}`
    const r = await fetch(url, { method: 'HEAD' })
    if (r.ok) reachable++
  }
  ok('the media files are actually served', reachable === sample.length, `${reachable}/${sample.length}`)

  for (const r of results) console.log(`${r.pass ? ' PASS' : ' FAIL'}  ${r.n}${r.d ? '  — ' + r.d : ''}`)
  const bad = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - bad}/${results.length} import checks passed`)
  process.exit(bad ? 1 : 0)
})()
