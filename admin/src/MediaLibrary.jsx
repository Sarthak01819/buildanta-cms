import React, { useEffect, useState } from 'react'
import { supabase, mediaUrl } from './supabase.js'
import { uploadMedia } from './media.js'

export default function MediaLibrary({ canWrite }) {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('media').select('*').order('created_at', { ascending: false })
    if (error) setErr(error.message); else setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const take = async (files) => {
    setBusy(true); setErr('')
    for (const f of files) {
      try { await uploadMedia(f) }
      catch (e) { setErr((p) => p + `\n${f.name}: ${e.message || e}`) }
    }
    setBusy(false); load()
  }

  const remove = async (m) => {
    // Storage first, then the row. The other order can leave a row pointing at
    // a file that no longer exists, which renders as a broken image forever.
    if (!confirm('Delete this file?')) return
    const { error: sErr } = await supabase.storage.from('media').remove([m.storage_path])
    if (sErr) { setErr(sErr.message); return }
    const { error } = await supabase.from('media').delete().eq('id', m.id)
    // RESTRICT on projects.card_media means this fails while a project uses it,
    // which is deliberate: deleting a file must never silently empty a project.
    if (error) {
      setErr(error.message.includes('violates foreign key')
        ? 'A project is still using this file. Change that project’s card image first.'
        : error.message)
    }
    load()
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Media <span className="pill">{rows.length}</span></h2>
      </div>
      {err && <p className="err">{err}</p>}

      {canWrite && (
        <div className={`drop ${over ? 'over' : ''}`} style={{ marginBottom: 18 }}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take([...e.dataTransfer.files]) }}>
          {busy ? 'Uploading…' : 'Drop images or video here'}
          <div className="hint" style={{ marginTop: 6 }}>
            Dimensions are read from the file and stored, so cards take the shape of the art.
          </div>
        </div>
      )}

      <div className="grid">
        {rows.map((m) => (
          <div className="card" key={m.id}>
            {m.kind === 'video'
              ? <video className="thumb" src={mediaUrl(m.storage_path)} muted loop playsInline autoPlay />
              : <img className="thumb" src={mediaUrl(m.storage_path)} alt={m.alt || ''} />}
            <div className="spread" style={{ marginTop: 8 }}>
              <span className="pill">{m.width}×{m.height}</span>
              {m.accent && <span className="swatch" style={{ background: m.accent }} title={m.accent} />}
            </div>
            <div className="hint">{Math.round(m.bytes / 1024)} KB · {m.kind}</div>
            {canWrite && <button className="btn btn--danger" style={{ marginTop: 8 }}
              onClick={() => remove(m)}>Delete</button>}
          </div>
        ))}
      </div>
      {!rows.length && <p className="hint">No files yet.</p>}
    </>
  )
}
