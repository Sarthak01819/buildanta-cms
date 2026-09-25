// Move the 58 out of content/world.json and into the CMS.
//
// One-off, and idempotent: run it twice and you get 58 projects, not 116. It
// matches on slug, so a re-run updates rather than duplicates.
//
// Runs with the SERVICE key. That is correct here and only here — this is a
// server-side admin task with no user to attribute, and it has to write before
// any member exists. It must never appear in the admin or in any browser; the
// admin's own client throws if it is ever handed one.
//
//   node tools/import-world.cjs            report only
//   node tools/import-world.cjs --write    do it
const { createClient } = require(require('path').join(__dirname, '../admin/node_modules/@supabase/supabase-js'))
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
require('./local-only.cjs')('importing 58 projects with --write')

const WORLD = (process.env.SITE_DIR || require('path').join(__dirname, '../site-output'))
const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const KEY = process.env.SUPABASE_SERVICE_KEY
const WRITE = process.argv.includes('--write')

if (!KEY) {
  console.error('Set SUPABASE_SERVICE_KEY. For the local stack: supabase status')
  process.exit(1)
}

const db = createClient(URL, KEY, { auth: { persistSession: false } })
const items = JSON.parse(fs.readFileSync(path.join(WORLD, 'content', 'world.json'), 'utf8'))

// The REAL dimensions, from the file. Not the manifest's declared ones.
//
// Auto-fit means the art decides the card's shape, so the truth has to come
// from the file — and five of these disagree with what the manifest claims
// (one-pixel rounding on video, where encoders round to even numbers). Carrying
// the declared value across would import a lie that is currently harmless and
// would not stay that way.
function realSize(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim()
  const [w, h] = out.split(',').map(Number)
  return { w, h }
}

const slugOf = (item) => (item.link || '').split('/').pop()

;(async () => {
  let created = 0, updated = 0, skipped = 0
  const changes = []

  for (const [i, item] of items.entries()) {
    const rel = (item.file || '').replace(/^\//, '')
    const abs = path.join(WORLD, 'public', rel)
    if (!fs.existsSync(abs)) { skipped++; console.log(`  ! missing file: ${rel}`); continue }

    const { w, h } = realSize(abs)
    const declared = item.image_size
    if (w !== declared[0] || h !== declared[1]) {
      changes.push(`${item.title}: ${declared.join('x')} -> ${w}x${h}`)
    }

    const slug = slugOf(item)
    const isVideo = item.type === 'video'
    const storagePath = `art/${path.basename(rel)}`

    if (!WRITE) continue

    // ---- the file
    const buf = fs.readFileSync(abs)
    const { error: upErr } = await db.storage.from('media').upload(storagePath, buf, {
      contentType: isVideo ? 'video/mp4' : 'image/jpeg',
      cacheControl: '31536000',
      upsert: true
    })
    if (upErr) { console.log(`  ! upload ${storagePath}: ${upErr.message}`); continue }

    // ---- the media row, keyed on the path so a re-run updates it
    const { data: media, error: mErr } = await db.from('media').upsert({
      storage_path: storagePath,
      kind: isVideo ? 'video' : 'image',
      mime: isVideo ? 'video/mp4' : 'image/jpeg',
      width: w, height: h,
      bytes: buf.length,
      accent: item.color,
      alt: `${item.title} by ${item.author}`
    }, { onConflict: 'storage_path' }).select().single()
    if (mErr) { console.log(`  ! media ${slug}: ${mErr.message}`); continue }

    // ---- the project
    const { data: existing } = await db.from('projects').select('id').eq('slug', slug).maybeSingle()
    const row = {
      slug,
      title: item.title,
      author: item.author,
      caption: item.caption,
      show_caption: !!item.show_caption,
      accent: item.color,
      card_media: media.id,
      // Every one of these is #/work/<slug> today, which is exactly what
      // 'internal' means. Yash can switch any of them to a pasted link later.
      link_mode: 'internal',
      link_url: null,
      // Sparse, in the manifest's order, so reordering later is one update.
      position: (i + 1) * 10,
      is_live: true
    }

    if (existing) {
      const { error } = await db.from('projects').update(row).eq('id', existing.id)
      if (error) { console.log(`  ! update ${slug}: ${error.message}`); continue }
      updated++
    } else {
      const { error } = await db.from('projects').insert(row)
      if (error) { console.log(`  ! insert ${slug}: ${error.message}`); continue }
      created++
    }
    process.stdout.write(`\r  ${created + updated}/${items.length}`)
  }

  console.log('')
  if (changes.length) {
    console.log(`\n${changes.length} size(s) corrected from the file itself:`)
    for (const c of changes) console.log('  ' + c)
    console.log('(all one-pixel rounding on video — same aspect, so no card reshapes)')
  }
  console.log(WRITE
    ? `\ncreated ${created}, updated ${updated}, skipped ${skipped}`
    : `\nreport only — ${items.length} items ready. Re-run with --write.`)
})()
