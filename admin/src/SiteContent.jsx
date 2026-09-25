import React, { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// The rest of the site: the services, and the heading above each section.
//
// This was a JSON box per key. The reasoning was sound — the copy lives in a
// hand-built WebGL intro whose shape moves with the design, and a fixed form
// needs a code change every time a section gains a line. What it produced was a
// screen that asks the person writing the copy to edit `{"lines": [...]}` by
// hand and get the commas right, on the one screen whose entire audience is
// people who do not write code.
//
// So: a real form for the two shapes that actually exist, and the raw box kept
// as the fallback for anything that does not match one of them. A new shape
// still works on day one; it just looks like the old screen until somebody
// teaches this file about it.

// ── the two shapes, described once ──────────────────────────────────────────
//
// `hidden` fields are carried through untouched on save. `id` identifies the
// service to the site's code and `position` is what the arrows move; neither is
// anybody's business while writing copy.
const SERVICE_FIELDS = [
  ['word',  'The big word',        'input',    'Shown huge. One or two words.'],
  ['line',  'The headline',        'textarea', 'Press Enter for a line break.'],
  ['tag',   'The small label',     'input',    'The little line of capitals, e.g. GOOGLE · META · CREATIVE'],
  ['what',  'What it is',          'textarea', 'A sentence or two, in plain words.'],
  ['who',   "Who it's for",        'textarea', 'The kind of business that should buy this.'],
  ['gets',  'What they get',       'list',     'One line per thing. These appear as a list.'],
  ['art',   'Picture file',        'input',    'The image file name, e.g. 03-paid.jpg']
]

const SECTION_FIELDS = [
  ['eyebrow', 'The small label', 'input', 'The little line above the heading, e.g. 01 / Deployed Systems'],
  ['lines',   'The heading',     'list',  'One line per line of the heading.']
]

const isService = (v) => v && typeof v === 'object' && 'word' in v && Array.isArray(v.gets)
const isSection = (v) => v && typeof v === 'object' && Array.isArray(v.lines) && 'eyebrow' in v

// The site's headline carries <br> to force a line break. Nobody writing copy
// should have to type a tag, and nobody should have to know it is there — so it
// becomes a real line break in the box and goes back to <br> on the way out.
// Exact round trip: these strings hold one or the other, never both.
const inBreaks = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, '\n')
const outBreaks = (s) => String(s ?? '').replace(/\r?\n/g, '<br>')

function Lines({ value, disabled, onChange }) {
  const list = Array.isArray(value) ? value : []
  const set = (i, t) => onChange(list.map((x, j) => (j === i ? t : x)))
  return (
    <>
      {list.map((t, i) => (
        <div className="lines__row" key={i}>
          <textarea rows={1} value={t} disabled={disabled}
            onChange={(e) => set(i, e.target.value)} />
          {!disabled && (
            <button className="lines__x" title="Remove this line"
              onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button>
          )}
        </div>
      ))}
      {!disabled && (
        <button className="btn btn--small" onClick={() => onChange([...list, ''])}>
          Add a line
        </button>
      )}
    </>
  )
}

function Entry({ row, canWrite, onSaved, onError }) {
  const [value, setValue] = useState(row.value)
  const [raw, setRaw] = useState(() => JSON.stringify(row.value, null, 2))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setValue(row.value); setRaw(JSON.stringify(row.value, null, 2)); setDirty(false) },
    [row.value])

  const fields = isService(row.value) ? SERVICE_FIELDS : isSection(row.value) ? SECTION_FIELDS : null
  const set = (k, v) => { setValue((x) => ({ ...x, [k]: v })); setDirty(true) }

  const save = async () => {
    let out = value
    if (!fields) {
      try { out = JSON.parse(raw) }
      catch { onError(`${row.key}: that is not valid JSON`); return }
    }
    setBusy(true)
    // Spread over the ORIGINAL value, so `id`, `position` and anything this
    // file has never heard of survive a save it was not part of.
    const { error } = await supabase.from('site_content')
      .update({ value: fields ? { ...row.value, ...out } : out }).eq('key', row.key)
    setBusy(false)
    if (error) onError(error.message)
    else { setDirty(false); onSaved(row.key) }
  }

  // The name a person would use, not the database key.
  const heading = isService(row.value)
    ? (value.word || row.key)
    : isSection(row.value)
      ? (row.value.eyebrow || row.key).replace(/^\d+\s*\/\s*/, '')
      : row.key

  return (
    <section className="block">
      <div className="spread" style={{ marginBottom: 14 }}>
        <h3 className="block__h" style={{ margin: 0 }}>{heading}</h3>
        <div className="row">
          {dirty && <span className="pill pill--warn">Not saved yet</span>}
          {canWrite && <button className="btn" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>}
        </div>
      </div>

      {!fields && (
        <>
          <p className="block__sub">
            This one has a shape the form does not know yet, so it is shown as it
            is stored. Take care with the commas and brackets.
          </p>
          <textarea className="box" style={{ width: '100%', minHeight: 120 }}
            value={raw} disabled={!canWrite}
            onChange={(e) => { setRaw(e.target.value); setDirty(true) }} />
        </>
      )}

      {fields && fields.map(([k, label, kind, hint]) => (
        <div className="field" key={k}>
          <label>{label}</label>
          {kind === 'list'
            ? <Lines value={value[k]} disabled={!canWrite} onChange={(v) => set(k, v)} />
            : kind === 'textarea'
              ? <textarea rows={k === 'line' ? 3 : 2}
                  value={k === 'line' ? inBreaks(value[k]) : (value[k] ?? '')}
                  disabled={!canWrite}
                  onChange={(e) => set(k, k === 'line' ? outBreaks(e.target.value) : e.target.value)} />
              : <input type="text" value={value[k] ?? ''} disabled={!canWrite}
                  onChange={(e) => set(k, e.target.value)} />}
          {hint && <p className="hint">{hint}</p>}
        </div>
      ))}
    </section>
  )
}

export default function SiteContent({ canWrite }) {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const load = async () => {
    const { data, error } = await supabase.from('site_content').select('*')
      .order('section').order('key')
    if (error) setErr(error.message); else setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const services = rows.filter((r) => isService(r.value))
    // The site orders services by `position`; so does this screen, or the list
    // here and the list on the site are two different lists.
    .sort((a, b) => (a.value.position ?? 0) - (b.value.position ?? 0))
  const sections = rows.filter((r) => isSection(r.value))
  const other = rows.filter((r) => !isService(r.value) && !isSection(r.value))

  const saved = (key) => { setErr(''); setNote(`Saved`); load() }
  const fail = (m) => { setNote(''); setErr(m) }

  // Kept, not deleted. Adding a key does nothing on the site until code reads
  // it, so this is a developer's tool — but it was here, and quietly removing
  // something that worked is not simplification. It lives at the bottom now
  // instead of as a primary button at the top.
  const add = async () => {
    const key = prompt('Key (lowercase, dots and dashes) e.g. intro.headline')
    if (!key) return
    const { error } = await supabase.from('site_content')
      .insert({ key, section: key.split('.')[0], value: { text: '' } })
    if (error) fail(error.message); else load()
  }

  return (
    <>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>The website's words</h2>
      <p className="hint" style={{ marginTop: 0, marginBottom: 18 }}>
        Everything on the site that is not a project. Changes reach the website
        when you press Publish.
      </p>
      {err && <p className="err">{err}</p>}
      {note && <p className="ok">{note}</p>}

      {services.length > 0 && (
        <>
          <h3 className="group__h">What we do <span className="pill">{services.length}</span></h3>
          {services.map((r) => (
            <Entry key={r.key} row={r} canWrite={canWrite} onSaved={saved} onError={fail} />
          ))}
        </>
      )}

      {sections.length > 0 && (
        <>
          <h3 className="group__h">Headings on the page <span className="pill">{sections.length}</span></h3>
          {sections.map((r) => (
            <Entry key={r.key} row={r} canWrite={canWrite} onSaved={saved} onError={fail} />
          ))}
        </>
      )}

      {other.length > 0 && (
        <>
          <h3 className="group__h">Everything else <span className="pill">{other.length}</span></h3>
          {other.map((r) => (
            <Entry key={r.key} row={r} canWrite={canWrite} onSaved={saved} onError={fail} />
          ))}
        </>
      )}

      {!rows.length && <p className="hint">Nothing yet. The site's own copy will live here.</p>}

      {canWrite && (
        <p className="hint" style={{ marginTop: 26 }}>
          Adding something new here only shows up on the website once it has been
          built into a page.{' '}
          <button className="btn btn--quiet" onClick={add}>Add a key anyway</button>
        </p>
      )}
    </>
  )
}
