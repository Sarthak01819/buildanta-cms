// End-to-end against a REAL local Supabase: sign up, upload, edit, publish.
//
// The whole point is that RLS is the security boundary here — there is no
// server of ours in between. A UI test that stubs the database proves nothing
// about the thing that actually decides.
const { chromium } = require(require('path').join(__dirname, '../admin/node_modules/playwright'))
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const safeReset = require('./safe-reset.cjs')
require('./local-only.cjs')('verify-admin (it runs `supabase db reset`)')


const ADMIN = 'http://localhost:5300/'
const results = []
const ok = (n, pass, d = '') => results.push({ n, pass: !!pass, d })

// A real JPEG to upload, generated rather than committed.
function makeImage(file, w, h, colour) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi',
    '-i', `color=c=${colour}:s=${w}x${h}`, '-frames:v', '1', file])
}

;(async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cms-'))
  const wide = path.join(tmp, 'wide-card.jpg')      // 2:1 — the shape the DB must record
  const tall = path.join(tmp, 'tall-shot.jpg')
  makeImage(wide, 800, 400, 'green')
  makeImage(tall, 400, 700, 'purple')

  // Clean database: the FIRST account created becomes owner, so without a reset
  // a second run signs in as a viewer and every write correctly fails.
  console.log('resetting the database…')
  safeReset('verify-admin')

  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } })
  const errs = []
  // One handler for every dialog. The publish flow uses prompt() and confirm(),
  // and registering a `once` per call raced itself.
  p.on('dialog', (d) => d.accept('verify run'))
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)) })

  const email = `owner${Date.now()}@buildanta.test`

  // ---- sign up. The FIRST account must become owner.
  await p.goto(ADMIN, { waitUntil: 'networkidle' })
  await p.click('text=Create an account')
  await p.fill('input[autocomplete=username]', email)
  await p.fill('input[type=password]', 'test-password-123')
  await p.click('button:has-text("Create account")')
  await p.waitForTimeout(3500)

  const role = await p.evaluate(() => document.querySelector('.pill')?.textContent?.trim())
  ok('the first account becomes owner', role === 'owner', `role: ${role}`)
  ok('the admin loads after sign-in', await p.isVisible('text=Projects'))

  // ---- create a project
  await p.click('button:has-text("Add project")')
  await p.waitForTimeout(1500)
  ok('a new project opens in the editor', await p.isVisible('text=The photo'))

  // Yash: "very complex to use and read". The words the database uses must not
  // reach this screen — if any of them come back, the simplification is undone
  // and nobody would notice from a screenshot.
  const jargon = await p.evaluate(() => {
    const t = document.querySelector('.editor')?.innerText || ''
    return ['Slug', 'Accent', 'Card image', '#/work/', 'Body', 'link_mode', 'is_live']
      .filter((w) => t.includes(w))
  })
  ok('no developer words on the editor', jargon.length === 0, jargon.join(', '))

  // ---- a live project with no image must be refused BY THE DATABASE
  const liveBox = p.locator('input[type=checkbox]').last()
  ok('Live is disabled until there is a card image', await liveBox.isDisabled())

  // ---- upload the card. 800x400 must be recorded, not assumed.
  await p.setInputFiles('input[type=file] >> nth=0', wide)
  await p.waitForTimeout(4000)
  const sizeNote = await p.textContent('body')
  ok('the upload records the REAL dimensions', /800×400/.test(sizeNote), 'expected 800×400 in the UI')

  // ---- accent came from the image
  const accent = await p.inputValue('input[type=color]')
  ok('an accent is derived from the image', /^#[0-9a-f]{6}$/i.test(accent), accent)

  // ---- Yash's ask: paste an external link
  await p.fill('input[type=text] >> nth=0', 'Client Case Study')
  await p.click('text=A different website')
  await p.waitForTimeout(400)
  await p.fill('input[type=url]', 'https://client.example.com/the-work')
  await p.locator('input[type=checkbox]').last().check()
  await p.click('button:has-text("Save")')
  await p.waitForTimeout(2500)
  ok('a project with a pasted link saves', await p.isVisible('text=Saved'), errs.slice(0, 2).join(' | '))

  // ---- a bad URL must be refused, in words a person can act on
  await p.fill('input[type=url]', 'javascript:alert(1)')
  await p.click('button:has-text("Save")')
  await p.waitForTimeout(2000)
  const refused = await p.textContent('body')
  ok('a javascript: URL is refused', /http:\/\/ or https:\/\//.test(refused) || /refused/i.test(refused),
    'expected a readable error')
  await p.fill('input[type=url]', 'https://client.example.com/the-work')
  await p.click('button:has-text("Save")')
  await p.waitForTimeout(2000)
  // That rejection is SUPPOSED to fail, and the database refusing it surfaces
  // as a 400 in the console. Counting it as an unexpected error would make the
  // suite fail for doing exactly what it set out to prove.
  errs.length = 0

  // ---- the preview, which is the whole point of the rewrite
  const prev = await p.evaluate(() => {
    const stages = [...document.querySelectorAll('.prev__stage')]
    return {
      count: stages.length,
      // A preview that renders nothing has a DOM and no picture. Measure it.
      painted: stages.map((s) => s.getBoundingClientRect().height).filter((h) => h > 40).length,
      onRight: (() => {
        const a = document.querySelector('.editor__fields')?.getBoundingClientRect()
        const b = document.querySelector('.editor__preview')?.getBoundingClientRect()
        return !!a && !!b && b.left >= a.right - 2
      })(),
      sticky: getComputedStyle(document.querySelector('.editor__preview')).position === 'sticky',
      hasPhoto: !!document.querySelector('.prev__stage img, .prev__stage video')
    }
  })
  ok('the preview sits to the right of the fields', prev.onRight)
  ok('the preview stays put while the fields scroll', prev.sticky)
  ok('both views are drawn — in the grid and opened', prev.count === 2 && prev.painted === 2,
    `${prev.painted}/${prev.count} drawn`)
  ok('the preview shows the real photo', prev.hasPhoto)

  // Live as you type: change the name and the colour, and the preview must
  // follow WITHOUT a save. This is the behaviour Yash picked.
  await p.fill('input[type=text] >> nth=0', 'Renamed While Watching')
  await p.waitForTimeout(300)
  ok('the preview follows the name as you type',
    (await p.textContent('.prev__caption')).includes('Renamed While Watching'))

  await p.evaluate(() => {
    const i = document.querySelector('input[type=color]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(i, '#ff0000')
    i.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await p.waitForTimeout(300)
  const tint = await p.evaluate(() =>
    getComputedStyle(document.querySelector('.prev__side')).backgroundImage)
  ok('the preview follows the colour', /255,\s*0,\s*0/.test(tint), tint.slice(0, 70))

  await p.fill('input[type=text] >> nth=0', 'Client Case Study')
  await p.click('button:has-text("Save")')
  await p.waitForTimeout(2000)

  // ---- gallery
  await p.setInputFiles('input[type=file] >> nth=1', tall)
  await p.waitForTimeout(4000)
  const strip = await p.evaluate(() => {
    const items = [...document.querySelectorAll('.strip__item')]
    const img = items[0]?.querySelector('img')
    return { n: items.length, decoded: !!img && img.complete && img.naturalWidth > 0,
             removable: !!items[0]?.querySelector('.strip__x') }
  })
  ok('a gallery picture uploads, decodes and can be removed',
    strip.n === 1 && strip.decoded && strip.removable, JSON.stringify(strip))

  // ---- publish
  await p.click('button:has-text("All projects")')
  await p.waitForTimeout(1200)
  await p.click('.nav button:has-text("Publish")')
  await p.waitForTimeout(1500)
  await p.click('.main button:has-text("Publish")')
  await p.waitForTimeout(3500)
  ok('publishing writes a snapshot', /snapshot #\d+/.test(await p.textContent('body')))

  await p.screenshot({ path: require('path').join(process.env.CAPTURES_DIR || require('path').join(__dirname, '../captures'), 'ADMIN.png'), fullPage: false })
  // Video cards must render as VIDEO. 15 of the 58 are video, and an <img>
  // pointed at an .mp4 is a broken glyph — the world's own DOM index shipped
  // exactly this bug once, and the admin repeated it. Counted from the DOM's
  // own loaded state, not from the markup we intended to write.
  const thumbs = await p.evaluate(() => ({
    brokenImgs: [...document.querySelectorAll('img.thumb')]
      .filter((e) => e.complete && e.naturalWidth === 0).length,
    videos: document.querySelectorAll('video.thumb').length
  }))
  ok('no card thumbnail is a broken image', thumbs.brokenImgs === 0, `${thumbs.brokenImgs} broken`)

  ok('no console or page errors', errs.length === 0, errs.slice(0, 3).join(' | '))
  await b.close()

  // ---- and the payload the BUILD will read
  const q = (sql) => execFileSync('docker', ['exec', 'supabase_db_buildanta-cms',
    'psql', '-U', 'postgres', '-t', '-A', '-c', sql]).toString().trim()
  let payload = ''
  try {
    payload = q(`select payload->'projects'->0->>'link' || '|' ||
      (payload->'projects'->0->'card'->>'width') || 'x' ||
      (payload->'projects'->0->'card'->>'height')
      from site_snapshots where is_current`)
  } catch (e) { payload = 'could not read: ' + e.message.slice(0, 80) }
  ok('the snapshot carries the pasted URL and the true size',
    payload.startsWith('https://client.example.com/the-work|800x400'), payload)

  for (const r of results) console.log(`${r.pass ? ' PASS' : ' FAIL'}  ${r.n}${r.d ? '  — ' + r.d : ''}`)
  const bad = results.filter((r) => !r.pass).length
  console.log(`\n${results.length - bad}/${results.length} admin checks passed`)
  process.exit(bad ? 1 : 0)
})()
