// The build step: turn the published snapshot into what the site actually eats.
//
//   node tools/build-content.cjs             the current published snapshot
//   node tools/build-content.cjs --draft     unpublished edits, for preview
//   node tools/build-content.cjs --out DIR   where to write (default: the world)
//   node tools/build-content.cjs --art SUB    public/ subfolder for the media
//                                             (default 'art'; the real site
//                                              serves the world from 'world/art')
//
// Writes content/world.json and downloads the media beside it, so the built
// site has NO runtime dependency on Supabase. That is the whole point of
// delivering at build time: a visitor waits on nothing, and an outage cannot
// blank the page. It is also what keeps the single-file preview possible, since
// that inlines every asset and cannot inline a remote URL.
const { createClient } = require(require('path').join(__dirname, '../admin/node_modules/@supabase/supabase-js'))
const fs = require('fs')
const path = require('path')

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const KEY = process.env.SUPABASE_SERVICE_KEY
const DRAFT = process.argv.includes('--draft')
const outIdx = process.argv.indexOf('--out')
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : (process.env.SITE_DIR || require('path').join(__dirname, '../site-output'))

// Where the media lands under public/, and the URL prefix written into
// world.json — one value, so the two can never disagree.
//
// The standalone world serves /art/. The real site scopes it to /world/art/ so
// the world's assets cannot collide with the site's own. Writing to a fixed
// 'art' put 3.7 MB in a folder nothing read, beside an identical 3.7 MB in the
// folder that was read, and neither the build nor any check said a word.
const artIdx = process.argv.indexOf('--art')
const ART = (artIdx > -1 ? process.argv[artIdx + 1] : 'art').replace(/^\/|\/$/g, '')

if (!KEY) { console.error('Set SUPABASE_SERVICE_KEY'); process.exit(1) }
const db = createClient(URL, KEY, { auth: { persistSession: false } })

;(async () => {
  let payload, label

  if (DRAFT) {
    // Exactly what publish would store, without storing it — same function, so
    // preview cannot show something the build would not produce.
    const { data, error } = await db.rpc('build_payload')
    if (error) throw error
    payload = data
    label = 'DRAFT (unpublished edits)'
  } else {
    const { data, error } = await db
      .from('site_snapshots').select('id, payload, created_at').eq('is_current', true).maybeSingle()
    if (error) throw error
    if (!data) {
      console.error('Nothing is published yet. Publish from the admin, or use --draft.')
      process.exit(1)
    }
    payload = data.payload
    label = `snapshot #${data.id} (${new Date(data.created_at).toLocaleString()})`
  }

  const projects = payload.projects || []
  if (!projects.length) { console.error('That payload has no live projects.'); process.exit(1) }

  const artDir = path.join(OUT, 'public', ...ART.split('/'))
  fs.mkdirSync(artDir, { recursive: true })

  // The manifest the world already understands. Its shape is not negotiable —
  // the scene reads image_size to build card geometry and colour to drive the
  // open state, so this is a translation, not a redesign.
  const items = []
  let downloaded = 0, cached = 0
  // Skip a file we already have at the right size. A rebuild that re-downloads
  // 58 files every time is a rebuild nobody runs.
  const fetchArt = async (storagePath) => {
    const file = path.basename(storagePath)
    const dest = path.join(artDir, file)
    const want = await head(storagePath)
    if (fs.existsSync(dest) && want && fs.statSync(dest).size === want) { cached++; return file }
    const { data, error } = await db.storage.from('media').download(storagePath)
    if (error) { console.error(`  ! ${storagePath}: ${error.message}`); return null }
    fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()))
    downloaded++
    return file
  }

  for (const p of projects) {
    const file = await fetchArt(p.card.path)
    if (!file) continue

    // The gallery — "More pictures" in the admin — was being written, published
    // and then dropped here, so the field did nothing at all. Same for `body`.
    const gallery = []
    for (const g of p.gallery || []) {
      const gf = await fetchArt(g.path)
      if (gf) gallery.push({ type: g.kind, file: `/${ART}/${gf}`, image_size: [g.width, g.height] })
    }

    items.push({
      type: p.card.kind,
      title: p.title,
      author: p.author,
      caption: p.caption || '',
      link: p.link,
      color: p.accent,
      file: `/${ART}/${file}`,
      show_caption: !!p.show_caption,
      // The full story, as typed. Empty is meaningful — the page falls back to
      // its own placeholder prose only when there is genuinely nothing written.
      body: p.body || '',
      gallery,
      // From the file's real dimensions, recorded on upload. The card's shape
      // comes from these two numbers, so they are the load-bearing part.
      image_size: [p.card.width, p.card.height]
    })
  }

  const manifest = path.join(OUT, 'content', 'world.json')
  fs.mkdirSync(path.dirname(manifest), { recursive: true })
  fs.writeFileSync(manifest, JSON.stringify(items, null, 2) + '\n')

  // Site copy, for whatever consumes it.
  // Say so, loudly, rather than writing {} and reporting success.
  //
  // `build_payload()` returned its second key as `content` for one migration
  // and this line reads `site`. Nothing errored: site.json was written empty,
  // the build printed "site keys: 0" among four other lines, and the site's
  // own copy was gone. A missing key is a broken contract, not an empty result.
  if (!payload.site) {
    console.error('\n  build_payload() returned no `site` key.')
    console.error(`  It returned: ${Object.keys(payload).join(', ')}`)
    console.error('  Refusing to write an empty site.json over the real one.\n')
    process.exit(1)
  }
  fs.writeFileSync(path.join(OUT, 'content', 'site.json'),
    JSON.stringify(payload.site, null, 2) + '\n')

  console.log(`built from ${label}`)
  console.log(`  ${items.length} projects -> ${path.relative(process.cwd(), manifest)}`)
  console.log(`  media: ${downloaded} downloaded, ${cached} already current`)
  console.log(`  site keys: ${Object.keys(payload.site || {}).length}`)
  if (DRAFT) console.log('\n  ⚠️  DRAFT build — this includes edits nobody has published.')
})()

// HEAD the public URL for a size, so an unchanged file is not re-downloaded.
async function head(p) {
  try {
    const r = await fetch(`${URL}/storage/v1/object/public/media/${p}`, { method: 'HEAD' })
    const len = r.headers.get('content-length')
    return len ? Number(len) : null
  } catch { return null }
}
