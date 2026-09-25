// Pictures of the admin, taken against the REAL 58 projects.
//
// Shot from a throwaway owner account. Run `supabase db reset` + the two
// importers afterwards if you want the sign-up slot back — the first account
// created becomes owner, and that slot belongs to Yash.
const { chromium } = require(require('path').join(__dirname, '../admin/node_modules/playwright'))
const OUT = (process.env.CAPTURES_DIR || require('path').join(__dirname, '../captures'))

;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1440, height: 940 } })
  p.on('dialog', (d) => d.accept('shot'))

  await p.goto('http://localhost:5300/', { waitUntil: 'networkidle' })
  await p.click('text=Create an account')
  await p.fill('input[autocomplete=username]', `shot${Date.now()}@buildanta.test`)
  await p.fill('input[type=password]', 'test-password-123')
  await p.click('button:has-text("Create account")')
  await p.waitForTimeout(3500)

  await p.screenshot({ path: `${OUT}/ADMIN-LIST.png` })

  // A real project with a real photo, not a made-up one — the preview is only
  // worth photographing if it is showing actual work.
  await p.click('.grid .card >> nth=0')
  await p.waitForTimeout(2500)
  await p.screenshot({ path: `${OUT}/ADMIN-EDITOR.png` })

  // Scrolled to the link choices, because that is Yash's own ask — pasting a
  // link to another project — and it is below the fold.
  await p.evaluate(() => document.querySelector('.editor__fields')
    .children[3].scrollIntoView({ block: 'center' }))
  await p.waitForTimeout(600)
  await p.screenshot({ path: `${OUT}/ADMIN-EDITOR-LINK.png` })

  await b.close()
  console.log('shot: ADMIN-LIST, ADMIN-EDITOR, ADMIN-EDITOR-LINK')
})()
