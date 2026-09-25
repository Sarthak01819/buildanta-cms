// A first draft of the real project copy, for Yash to correct.
//
// He chose "I draft, you correct". Everything below is written from what our
// own work records — no invented clients, no invented numbers, no claims about
// results. Where I am unsure of a detail I have left the sentence general
// rather than guessed, because a confident wrong line is harder for him to spot
// than a vague one.
//
// Two deliberate omissions:
//   · No medical claims anywhere near DS Homeo. India's Drugs & Magic Remedies
//     Act makes cure/efficacy language on a clinic site a legal problem, not a
//     copy preference.
//   · No client outcome figures. I do not have verified ones, and a portfolio
//     is exactly where an unverified number gets quoted back at you.
//
// Applied to the first N projects by position, so the real work leads the grid
// and the placeholders fall in behind. Nothing is published — this writes
// drafts, and the site does not change until Yash presses Publish.
//
//   node tools/draft-content.cjs            report only
//   node tools/draft-content.cjs --write    do it
const { createClient } = require(require('path').join(__dirname, '../admin/node_modules/@supabase/supabase-js'))
require('./local-only.cjs')('drafting project copy with --write')

const KEY = process.env.SUPABASE_SERVICE_KEY
const WRITE = process.argv.includes('--write')
if (!KEY) { console.error('Set SUPABASE_SERVICE_KEY'); process.exit(1) }
const db = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', KEY,
  { auth: { persistSession: false } })

const DRAFTS = [
  { title: 'Dhandho',
    caption: 'Hindi-first books for Indian shops.',
    body: 'Billing, ledger, stock and staff for a shop that runs in Hindi — built because the accounting software Indian shopkeepers are sold assumes they read English and employ someone to do data entry. Invoicing, a running customer ledger, a barcode counter with batch and expiry, shared expenses between partners, and a CA pack at the end of the year.' },

  { title: 'Panchratna Jewellers',
    caption: 'A jewellery house, online.',
    body: 'A showcase site for a Kanpur jewellery house — built in our premium lane, where the brief is that the site should feel like the shop rather than like a catalogue.' },

  { title: 'Sai Applewood',
    caption: 'A school site parents can actually use.',
    body: 'A website for Sai Applewood Public School. The audience is a parent on a phone, on mobile data, looking for one specific thing — so the build is organised around finding that thing quickly rather than around the brochure.' },

  { title: 'Kids Canvas',
    caption: 'A play school, on the web and on the gate.',
    body: 'Website and identity for Kids Canvas, and the school where our RFID attendance work started — the gate hardware and the parent-facing system grew out of what this one school needed.' },

  { title: 'TapScholar',
    caption: 'RFID attendance, then the whole school.',
    body: 'A school ERP that began as an RFID attendance gate and grew into fees, records and parent communication. Built for one school first and then generalised, which is the only order that produces software a school will actually use.' },

  { title: 'AquaLevel',
    caption: 'Know your water tank from your phone.',
    body: 'A water-level sensor for domestic and commercial tanks, with the reading on a phone. Aimed at Indian cities where the tank fills on a schedule nobody controls and the first sign of a problem is a dry tap.' },

  { title: 'ART Mechatronics',
    caption: 'Industrial automation, made findable.',
    body: 'A site for a Kanpur industrial automation firm, built alongside the search and answer-engine work — because a specialist supplier is only worth finding if the people looking can find them.' },

  { title: 'Buildanta Marketplace',
    caption: 'Construction material, ordered online.',
    body: 'A storefront for construction materials with cash on delivery and OTP checkout — the two things that decide whether an Indian contractor completes an order. Built so the same checkout serves a person and, later, an agent.' },

  { title: 'Buildanta Studios',
    caption: 'The Shutter — a scroll film.',
    body: 'A cinematic microsite that plays as one continuous film while you scroll. Made to answer a question we kept being asked: what does the expensive version actually look like.' },

  { title: 'DS Homeo Clinic',
    caption: 'A clinic online, with teleconsultation.',
    body: 'A website and teleconsultation booking flow for a homeopathy clinic in Kanpur, so a patient can find the practice, understand the timings and book without calling.' },

  { title: 'Saltwood',
    caption: 'Quiet, and fast.',
    body: 'A restrained brand site — the kind of build where the work shows up as everything you do not notice: how quickly it loads, how it behaves on a bad connection, how little it asks of you.' },

  { title: 'Jarvis',
    caption: 'A voice assistant that speaks Hinglish.',
    body: 'A speaking assistant built for how people in India actually talk — Hindi and English in the same sentence, which is the case almost every voice product handles badly.' }
]

;(async () => {
  const { data: rows, error } = await db
    // The whole row, not just the columns being changed. An upsert has to
    // satisfy the INSERT path even when it takes the UPDATE branch, so any
    // NOT NULL column left out is rejected — `accent` has no default and fails
    // the whole batch with a message that names the column and not the cause.
    .from('projects').select('*')
    .order('position').order('created_at').limit(DRAFTS.length)
  if (error) { console.error(error.message); process.exit(1) }

  if (rows.length < DRAFTS.length) {
    console.error(`only ${rows.length} projects exist; ${DRAFTS.length} drafts ready`)
    process.exit(1)
  }

  // The address follows the name, but only while it is still one we generated.
  const AUTO = /^(placeholder-\d+|new-project-[a-z0-9]+)$/
  const slugFor = (title, current) => AUTO.test(current)
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || current
    : current

  const plan = rows.map((r, i) => ({
    ...r,
    card: undefined,
    was: r.title,
    ...DRAFTS[i],
    slug: slugFor(DRAFTS[i].title, r.slug),
    show_caption: true
  }))

  for (const p of plan) console.log(`  ${p.was.padEnd(16)} → ${p.title.padEnd(22)} /work/${p.slug}`)

  if (!WRITE) { console.log(`\nreport only — ${plan.length} drafts ready. Re-run with --write.`); return }

  // One trip, not twelve.
  const { error: wErr } = await db.from('projects').upsert(
    plan.map(({ was, card, ...row }) => row), { onConflict: 'id' })
  if (wErr) { console.error('failed:', wErr.message); process.exit(1) }
  console.log(`\nwrote ${plan.length} drafts. Nothing is published — press Publish in the admin when the words are right.`)
})()
