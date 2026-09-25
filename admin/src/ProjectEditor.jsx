import React, { useEffect, useState } from 'react'
import { supabase, mediaUrl } from './supabase.js'
import { uploadMedia } from './media.js'
import CardPreview from './CardPreview.jsx'
import { slugFrom } from './slug.js'

// Plain words, throughout.
//
// Yash: "too technical for a non-programmer". He was right — the first version
// said slug, accent, card image, body, and explained a link as
// "#/work/<slug>". Those are the words the database uses; nobody who writes the
// copy for this site thinks in them. Every label here is what the thing IS to
// the person editing it, and the hints say what will happen rather than what it
// is called.
const LINK_MODES = [
  ['internal', 'A page on our website',
   'We make the page. It shows the photo, the story and the pictures below.'],
  ['external', 'A different website',
   'Paste any web address. It opens in a new tab.'],
  ['none', 'Nowhere',
   'The photo opens big, and that is all.']
]

export default function ProjectEditor({ id, canWrite, onDone }) {
  const [p, setP] = useState(null)
  const [gallery, setGallery] = useState([])
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = async () => {
    const { data, error } = await supabase
      .from('projects').select('*, card:card_media(*)').eq('id', id).single()
    if (error) { setErr(error.message); return }
    setP(data); setDirty(false)
    const { data: g } = await supabase
      .from('project_media').select('position, media(*)').eq('project_id', id).order('position')
    setGallery((g || []).map((r) => ({ ...r.media, position: r.position })))
  }
  useEffect(() => { load() }, [id])

  const set = (k, v) => { setP((x) => ({ ...x, [k]: v })); setDirty(true); setNote('') }

  const save = async () => {
    setBusy(true); setErr(''); setNote('')
    const { card, ...row } = p
    const { error } = await supabase.from('projects').update({
      slug: slugFrom(row.title, row.slug), title: row.title, author: row.author,
      caption: row.caption, show_caption: row.show_caption,
      accent: row.accent, body: row.body,
      link_mode: row.link_mode,
      // An empty box is not a value. The database wants nothing at all when
      // there is no web address, and '' would fail with a confusing message.
      link_url: row.link_url?.trim() ? row.link_url.trim() : null,
      card_media: row.card_media, is_live: row.is_live
    }).eq('id', id)
    setBusy(false)
    if (error) { setErr(friendly(error)); return }
    setNote('Saved'); setDirty(false); load()
  }

  const pickPhoto = async (file) => {
    setBusy(true); setErr('')
    try {
      const m = await uploadMedia(file, { alt: p.title })
      setP((x) => ({ ...x, card_media: m.id, card: m, accent: m.accent || x.accent }))
      setDirty(true)
      setNote('Photo added. The colour below was picked from it — change it if you like.')
    } catch (e) { setErr(friendly(e)) }
    setBusy(false)
  }

  const addPicture = async (file) => {
    setBusy(true); setErr('')
    try {
      const m = await uploadMedia(file, { alt: p.title })
      const { error } = await supabase.from('project_media')
        .insert({ project_id: id, media_id: m.id, position: gallery.length * 10 })
      if (error) throw error
      load()
    } catch (e) { setErr(friendly(e)) }
    setBusy(false)
  }

  const removePicture = async (mid) => {
    await supabase.from('project_media').delete().eq('project_id', id).eq('media_id', mid)
    load()
  }

  const remove = async () => {
    if (!confirm(`Delete "${p.title}"? This cannot be undone.`)) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) { setErr(friendly(error)); return }
    onDone()
  }

  if (!p) return <p className="hint">{err || 'Loading…'}</p>
  const ro = !canWrite

  return (
    <>
      <div className="spread editor__top">
        <div>
          <button className="btn btn--quiet" onClick={onDone}>← All projects</button>
          <h2 className="editor__title">{p.title || 'Untitled'}</h2>
        </div>
        <div className="row">
          {dirty && <span className="pill pill--warn">Not saved yet</span>}
          {canWrite && <button className="btn btn--primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>}
        </div>
      </div>

      {err && <p className="err">{err}</p>}
      {note && <p className="ok">{note}</p>}

      <div className="editor">
        <div className="editor__fields">

          <section className="block">
            <h3 className="block__h">The photo</h3>
            <p className="block__sub">This is what people see in the grid.</p>
            {p.card
              ? <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
                  {p.card.kind === 'video'
                    ? <video className="shot" src={mediaUrl(p.card.storage_path)} muted loop playsInline autoPlay />
                    : <img className="shot" src={mediaUrl(p.card.storage_path)} alt="" />}
                  <div>
                    <p className="hint" style={{ marginTop: 0 }}>
                      {p.card.width}×{p.card.height}
                    </p>
                  {canWrite && <label className="btn">
                    Change photo
                    <input type="file" accept="image/*,video/*" hidden
                      onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])} />
                  </label>}
                  </div>
                </div>
              : <>
                  <p className="hint">No photo yet. A project needs one before it can go on the website.</p>
                  {canWrite && <label className="btn btn--primary">
                    Add a photo
                    <input type="file" accept="image/*,video/*" hidden
                      onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])} />
                  </label>}
                </>}
          </section>

          <section className="block">
            <h3 className="block__h">The words</h3>
            <div className="field">
              <label>Name of the project</label>
              <input type="text" className="input--big" value={p.title || ''} disabled={ro}
                onChange={(e) => set('title', e.target.value)} />
            </div>
            <div className="field">
              <label>Who made it</label>
              <input type="text" value={p.author || ''} disabled={ro}
                onChange={(e) => set('author', e.target.value)} />
            </div>
            <div className="field">
              <label>One line about it</label>
              <input type="text" value={p.caption || ''} disabled={ro}
                onChange={(e) => set('caption', e.target.value)} />
              <label className="check">
                <input type="checkbox" checked={!!p.show_caption} disabled={ro}
                  onChange={(e) => set('show_caption', e.target.checked)} />
                Show this line under the photo
              </label>
            </div>
            <div className="field">
              <label>The full story</label>
              <textarea value={p.body || ''} disabled={ro}
                onChange={(e) => set('body', e.target.value)} />
              <p className="hint">Only appears if the photo opens a page on our website.</p>
            </div>
          </section>

          <section className="block">
            <h3 className="block__h">The colour</h3>
            <p className="block__sub">
              Everything glows in this colour when someone opens the project.
              Picked from the photo — change it if you want.
            </p>
            <div className="row">
              <input type="color" value={p.accent || '#888888'} disabled={ro}
                onChange={(e) => set('accent', e.target.value)} />
              <code className="hint">{p.accent}</code>
            </div>
          </section>

          <section className="block">
            <h3 className="block__h">When someone clicks the photo</h3>
            {LINK_MODES.map(([val, label, hint]) => (
              <label key={val} className="choice">
                <input type="radio" name="linkmode" value={val} disabled={ro}
                  checked={p.link_mode === val} onChange={() => set('link_mode', val)} />
                <span>
                  <strong>{label}</strong>
                  <em>{hint}</em>
                </span>
              </label>
            ))}
            {p.link_mode === 'external' && (
              <div className="field" style={{ marginTop: 10 }}>
                <input type="url" placeholder="https://…" value={p.link_url || ''} disabled={ro}
                  onChange={(e) => set('link_url', e.target.value)} />
                <p className="hint">Must start with http:// or https://</p>
              </div>
            )}
          </section>

          <section className="block">
            <h3 className="block__h">More pictures</h3>
            <p className="block__sub">Shown further down the project's own page.</p>
            {gallery.length > 0 && (
              <div className="strip">
                {gallery.map((m) => (
                  <div key={m.id} className="strip__item">
                    {m.kind === 'video'
                      ? <video src={mediaUrl(m.storage_path)} muted loop playsInline autoPlay />
                      : <img src={mediaUrl(m.storage_path)} alt="" />}
                    {canWrite && <button className="strip__x" title="Remove"
                      onClick={() => removePicture(m.id)}>×</button>}
                  </div>
                ))}
              </div>
            )}
            {canWrite && <label className="btn" style={{ marginTop: 10 }}>
              Add a picture
              <input type="file" accept="image/*,video/*" hidden
                onChange={(e) => e.target.files?.[0] && addPicture(e.target.files[0])} />
            </label>}
          </section>

          <section className="block">
            <h3 className="block__h">On the website</h3>
            <label className="check check--big">
              <input type="checkbox" checked={!!p.is_live} disabled={ro || !p.card_media}
                onChange={(e) => set('is_live', e.target.checked)} />
              Show this project on the website
            </label>
            {!p.card_media && <p className="hint">Add a photo first.</p>}
            <p className="hint" style={{ marginTop: 10 }}>
              Nothing reaches the website until you press Publish.
            </p>
          </section>

          <section className="block block--danger">
            <h3 className="block__h">Delete</h3>
            <p className="block__sub">
              Gone for good. To just take it off the website, untick the box above instead.
            </p>
            {canWrite && <button className="btn btn--danger" onClick={remove}>Delete this project</button>}
          </section>
        </div>

        {/* Sticky, so it stays in view while the fields scroll — the point is
            watching the effect of what you are changing. */}
        <aside className="editor__preview">
          <CardPreview item={p} media={p.card} />
          {dirty && <p className="hint" style={{ marginTop: 10 }}>
            Showing your changes. Press Save to keep them.
          </p>}
        </aside>
      </div>
    </>
  )
}

// Database errors are precise and unreadable. These are the ones a person
// actually hits, in words that say what to do.
function friendly(e) {
  const m = e?.message || String(e)
  if (m.includes('external_link_needs_url'))
    return 'Add the web address, starting with https:// — or choose a different option for the click.'
  if (m.includes('live_needs_a_card'))
    return 'Add a photo before putting this on the website.'
  if (m.includes('projects_slug_key') || m.includes('duplicate key'))
    return 'Another project already uses that name. Try a slightly different one.'
  if (m.includes('row-level security') || m.includes('permission denied'))
    return 'You do not have permission to change this. Ask Yash.'
  return m
}
