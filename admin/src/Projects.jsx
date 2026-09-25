import React, { useEffect, useRef, useState } from 'react'
import { supabase, mediaUrl } from './supabase.js'
import { slugFrom } from './slug.js'

// The database stores internal/external/none. Nobody editing the website
// thinks in those words, so they never leave this file.
const CLICK_SAYS = {
  internal: 'Opens its own page',
  external: 'Opens another website',
  none: 'Just shows the photo'
}

// A name you can type over, in place.
//
// An input that only becomes an input on click: a permanent box on every card
// would turn the grid into a form. Enter and clicking away both commit; Escape
// puts the old name back, which is the only way to undo a rename you started
// by mis-clicking.
function Name({ value, canWrite, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const box = useRef(null)
  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) { box.current?.focus(); box.current?.select() } }, [editing])

  if (!editing) return (
    <strong className={'name' + (canWrite ? ' name--edit' : '')}
      title={canWrite ? 'Click to rename' : undefined}
      onClick={canWrite ? (e) => { e.stopPropagation(); setEditing(true) } : undefined}>
      {value}
    </strong>
  )
  const stop = () => { setEditing(false); onCommit(draft) }
  return (
    <input ref={box} className="name name--box" value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={stop}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); stop() }
        // Escape must restore BEFORE the blur handler fires, or blur commits
        // the abandoned draft anyway.
        if (e.key === 'Escape') { setDraft(value); setEditing(false) }
      }} />
  )
}

// A video thumbnail that does not exist until you scroll near it.
//
// `loading="lazy"` covers images; video has no equivalent, and `preload="none"`
// is ignored the moment you add autoPlay — so 15 clips were being fetched and
// decoded at once for a screen that shows about ten cards. Mounting on approach
// is the only thing that actually defers it. 300px of margin means it is
// already playing by the time it is looked at.
function LazyVideo({ src, accent }) {
  const box = useRef(null)
  const vid = useRef(null)
  const [near, setNear] = useState(false)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!box.current || near) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setNear(true); io.disconnect() }
    }, { rootMargin: '300px' })
    io.observe(box.current)
    return () => io.disconnect()
  }, [near])

  // Start it by hand.
  //
  // `<video muted autoPlay>` in React is not the same as it is in HTML: React
  // assigns `muted` as a DOM property AFTER the element is in the document, and
  // Chrome has already decided by then that an unmuted video may not autoplay.
  // The clip loads to readyState 4 and sits there paused — which looks like a
  // broken thumbnail rather than a paused video, because these clips open on a
  // black frame. Setting muted first, then calling play(), is the whole fix.
  useEffect(() => {
    if (!near || !vid.current) return
    vid.current.muted = true
    vid.current.play().catch(() => {})   // a refusal is not worth an error
  }, [near])

  return (
    // Hold the tint until a frame is actually on screen, not merely until the
    // element exists. These clips open on black, so between mounting and the
    // first painted frame the card reads as a broken thumbnail.
    <div ref={box} className="thumb"
      style={{ background: playing ? 'transparent' : accent + '22' }}>
      {near && <video ref={vid} src={src} muted loop playsInline autoPlay
        onPlaying={() => setPlaying(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                 opacity: playing ? 1 : 0, transition: 'opacity .25s' }} />}
    </div>
  )
}

function friendly(e) {
  const m = e?.message || String(e)
  if (m.includes('duplicate key') || m.includes('projects_slug_key'))
    return 'Another project already uses that name.'
  if (m.includes('row-level security') || m.includes('permission denied'))
    return 'You do not have permission to rename this.'
  return m
}

export default function Projects({ canWrite, onOpen }) {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*, card:card_media(storage_path, width, height, kind)')
      .order('position').order('created_at')
    if (error) setErr(error.message); else setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const add = async () => {
    setBusy(true); setErr('')
    // A new project cannot be live yet — the database refuses a live project
    // with no card image, because that is a hole in the grid.
    const stamp = Date.now().toString(36)
    const { data, error } = await supabase.from('projects').insert({
      slug: `new-project-${stamp}`,
      title: 'New project',
      accent: '#8a8a8a',
      is_live: false,
      position: (rows.at(-1)?.position ?? 0) + 10
    }).select().single()
    setBusy(false)
    if (error) { setErr(error.message); return }
    onOpen(data.id)
  }

  // Rename without opening anything.
  //
  // Yash is doing a fast pass over 58 placeholder names. Open → type → save →
  // back is four clicks and two page states per name; here it is a click and
  // Enter. Only the title moves — everything else still lives in the editor,
  // because everything else needs the preview beside it to judge.
  const rename = async (p, title) => {
    const clean = title.trim()
    if (!clean || clean === p.title) return
    // The address follows the name while it is still one we invented, so the
    // portfolio does not end up living on /work/placeholder-23.
    const slug = slugFrom(clean, p.slug)
    setRows((r) => r.map((x) => (x.id === p.id ? { ...x, title: clean, slug } : x)))
    const { error } = await supabase.from('projects').update({ title: clean, slug }).eq('id', p.id)
    // Put the old name back rather than leaving the screen claiming a save that
    // did not happen.
    if (error) { setErr(friendly(error)); load() }
  }

  // Sparse positions (10, 20, 30…) make a move ONE update instead of
  // renumbering the table.
  const move = async (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const a = rows[i], b = rows[j]
    setRows((r) => { const c = [...r]; [c[i], c[j]] = [c[j], c[i]]; return c })
    const { error } = await supabase.from('projects').upsert([
      { id: a.id, position: b.position }, { id: b.id, position: a.position }
    ])
    if (error) { setErr(error.message); load() }
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Projects <span className="pill">{rows.length}</span></h2>
        {canWrite && <button className="btn btn--primary" onClick={add} disabled={busy}>Add project</button>}
      </div>
      {err && <p className="err">{err}</p>}
      <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
        Click a project to change it, or click its <em>name</em> to rename it here.
        The order below is the order on the website.
      </p>
      <div className="grid">
        {rows.map((p, i) => (
          // The whole card opens it. A small "Edit" button beside a big picture
          // is a guess about where to click; the picture is the thing being
          // edited, so the picture is the target.
          <div className="card card--open" key={p.id} onClick={() => onOpen(p.id)}>
            {/* By KIND, not by extension and not by assumption.
                15 of these 58 are video, and an <img> pointed at an .mp4 is a
                broken glyph — the same bug the world's own DOM index shipped
                with, for the same reason. */}
            {!p.card?.storage_path
              ? <div className="thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--dim)', fontSize: 12 }}>no photo</div>
              : p.card.kind === 'video'
                // Below the fold costs nothing until it is scrolled to. 58
                // cards fetched eagerly was 3.7 MB and 15 simultaneous video
                // decodes, for a screen that shows about ten of them.
                ? <LazyVideo src={mediaUrl(p.card.storage_path)} accent={p.accent} />
                : <img className="thumb" src={mediaUrl(p.card.storage_path)}
                    alt="" loading="lazy" decoding="async" />}
            <div className="spread" style={{ marginTop: 10 }}>
              <Name value={p.title} canWrite={canWrite} onCommit={(t) => rename(p, t)} />
              <span className="swatch" style={{ background: p.accent }} title={p.accent} />
            </div>
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
              {/* What it DOES, not what the column is called. */}
              <span className="pill">{CLICK_SAYS[p.link_mode] || CLICK_SAYS.none}</span>
              {!p.is_live && <span className="pill" style={{ color: 'var(--danger)' }}>Not on the website</span>}
            </div>
            {canWrite && (
              // stopPropagation, or reordering also opens the editor.
              <div className="row" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn" title="Move earlier"
                  onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn" title="Move later"
                  onClick={() => move(i, 1)} disabled={i === rows.length - 1}>↓</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!rows.length && <p className="hint">Nothing here yet.</p>}
    </>
  )
}
