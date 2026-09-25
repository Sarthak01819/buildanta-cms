// Move the site's own copy — services and section headings — into site_content.
//
// Read from the COPY at buildanta-site-world, never from the live site.
//
//   node tools/import-site.cjs            report only
//   node tools/import-site.cjs --write    do it
//
// Idempotent: keyed on `key`, so a re-run updates rather than duplicates.
const { createClient } = require(require('path').join(__dirname, '../admin/node_modules/@supabase/supabase-js'))
const fs = require('fs')
const path = require('path')
require('./local-only.cjs')('importing the site copy with --write')

const SITE = (process.env.SITE_DIR || require('path').join(__dirname, '../site-output'))
const KEY = process.env.SUPABASE_SERVICE_KEY
const WRITE = process.argv.includes('--write')
if (!KEY) { console.error('Set SUPABASE_SERVICE_KEY'); process.exit(1) }
const db = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', KEY,
  { auth: { persistSession: false } })

// The services array is a JS module, so it is imported rather than parsed. A
// regex over source would break the first time someone adds a trailing comma or
// a template literal, and this has to survive the file being edited by hand.
async function readServices() {
  const src = fs.readFileSync(path.join(SITE, 'src', 'modules', 'services.js'), 'utf8')

  // Read the FALLBACK array, which is the hardcoded copy.
  //
  // The site is CMS-driven now: `export const SERVICES` is a function call that
  // merges the built JSON over the fallback, so evaluating from that name pulls
  // in code it cannot run standalone — this failed with `fromCms is not
  // defined`. The array literal is the thing being imported, and it is still the
  // canonical hardcoded copy.
  const marker = src.includes('const FALLBACK = [') ? 'const FALLBACK = [' : 'export const SERVICES = ['
  const start = src.indexOf(marker)
  if (start < 0) throw new Error('could not find the services array in services.js')

  // Take just the array literal, not everything after it.
  const from = src.indexOf('[', start)
  let depth = 0, end = from
  for (let i = from; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  // eslint-disable-next-line no-new-func
  return new Function('return ' + src.slice(from, end))()
}

// The section headings live in index.html. Small and stable enough to name
// explicitly — a generic scraper would pull in structure and give the CMS a
// pile of keys nobody recognises.
function readSections() {
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
  const grab = (id) => {
    const i = html.indexOf(`id="${id}"`)
    if (i < 0) return null
    const block = html.slice(i, html.indexOf('<section', i + 10) || i + 4000)
    const bits = [...block.matchAll(/<(h1|h2|h3|p|span)[^>]*>([^<]{4,160})</g)]
      .map((m) => m[2].trim())
      .filter((t) => t && !/^&#/.test(t))
    return bits.length ? bits : null
  }
  const out = {}
  for (const id of ['systems', 'modules', 'infra', 'sequence', 'contact']) {
    const bits = grab(id)
    if (!bits) continue
    out[`section.${id}`] = {
      // First bit is the "01 / Deployed Systems" eyebrow; the rest is the line.
      eyebrow: bits[0],
      lines: bits.slice(1)
    }
  }
  return out
}

;(async () => {
  const services = await readServices()
  const sections = readSections()

  const rows = [
    ...services.map((s, i) => ({
      key: `service.${s.id}`,
      section: 'services',
      value: { ...s, position: (i + 1) * 10 }
    })),
    ...Object.entries(sections).map(([key, value]) => ({
      key, section: 'sections', value
    }))
  ]

  console.log(`${services.length} services, ${Object.keys(sections).length} section headings`)
  for (const r of rows.slice(0, 3)) console.log(`  ${r.key}`)
  console.log(`  … ${rows.length} keys total`)

  if (!WRITE) { console.log('\nreport only — re-run with --write'); return }

  const { error } = await db.from('site_content').upsert(rows, { onConflict: 'key' })
  if (error) { console.error('failed:', error.message); process.exit(1) }
  console.log(`\nwrote ${rows.length} keys into site_content`)
})()
