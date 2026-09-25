import React, { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Publishing writes ONE immutable snapshot of the whole site and marks it
// current. The build reads that row and nothing else.
//
// Why it matters: if the build queried the tables directly, a build that starts
// while someone is mid-edit ships half of one version and half of another, with
// nothing in the output to say so. A snapshot is taken at one instant, so a
// deploy is always internally consistent — and rolling back is picking an older
// snapshot id, not reverting edits by hand.
export default function Publish({ canWrite }) {
  const [snaps, setSnaps] = useState([])
  const [changes, setChanges] = useState(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase
      .from('site_snapshots')
      .select('id, note, created_at, is_current, payload')
      .order('id', { ascending: false }).limit(10)
    if (error) { setErr(error.message); return }
    setSnaps(data || [])

    // What would change if you published right now — computed by the SAME
    // function that builds the payload, so preview cannot disagree with what
    // actually ships.
    const { data: c, error: cErr } = await supabase.rpc('preview_changes')
    if (cErr) setErr(cErr.message); else setChanges(c)
  }
  useEffect(() => { load() }, [])

  const publish = async () => {
    const msg = prompt('A short note for this publish (optional)') || null
    setBusy(true); setErr(''); setNote('')
    const { data, error } = await supabase.rpc('publish_site', { note: msg })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setNote(`Published — snapshot #${data}. The site rebuilds from this.`)
    load()
  }

  const pending = changes
    ? (changes.added?.length || 0) + (changes.removed?.length || 0)
      + (changes.renamed?.length || 0) + (changes.changed?.length || 0)
    : 0

  return (
    <>
      <div className="spread" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Publish</h2>
        {canWrite && <button className="btn btn--primary" onClick={publish} disabled={busy}>
          {busy ? 'Publishing…' : pending ? `Publish ${pending} change${pending > 1 ? 's' : ''}` : 'Publish the site'}
        </button>}
      </div>
      {err && <p className="err">{err}</p>}
      {note && <p className="ok">{note}</p>}

      {changes && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="row" style={{ gap: 28 }}>
            <div><div className="hint">Live now</div><strong style={{ fontSize: 20 }}>{changes.draft_count}</strong></div>
            <div><div className="hint">Published</div><strong style={{ fontSize: 20 }}>{changes.live_count}</strong></div>
          </div>

          {!changes.has_published && (
            <p className="hint" style={{ marginTop: 12 }}>
              Never published. The site has nothing to build from yet.
            </p>
          )}

          {changes.has_published && pending === 0 && (
            <p className="ok" style={{ marginTop: 12 }}>
              Nothing to publish — the site matches what is live.
            </p>
          )}

          {pending > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="hint" style={{ marginBottom: 8 }}>
                Publishing would apply {pending} change{pending > 1 ? 's' : ''}:
              </div>
              {[['added', 'New', 'var(--ok)'],
                // Renamed sits above Edited and Removed on purpose: it is the
                // reassuring one, and it used to be reported as a deletion plus
                // an addition, which read as losing 12 projects.
                ['renamed', 'Renamed', 'var(--accent)'],
                ['changed', 'Edited', 'var(--accent)'],
                ['removed', 'Removed', 'var(--danger)']].map(([k, label, colour]) =>
                changes[k]?.length ? (
                  <div key={k} style={{ marginBottom: 8 }}>
                    <span className="pill" style={{ color: colour }}>{label} {changes[k].length}</span>
                    <span className="hint" style={{ marginLeft: 10 }}>{changes[k].join(', ')}</span>
                  </div>
                ) : null
              )}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <strong style={{ fontSize: 13 }}>See it before it ships</strong>
        <p className="hint" style={{ marginTop: 6 }}>
          Build the site from your unpublished edits and open it locally. Visitors
          are unaffected — nothing about the live site changes until you publish.
        </p>
        <pre style={{ background: '#0e0e10', padding: 12, borderRadius: 7, overflowX: 'auto', fontSize: 12 }}>
node tools/build-content.cjs --draft{'\n'}cd ../unseen-world && npm run dev
        </pre>
      </div>

      <h3 style={{ fontSize: 14 }}>History</h3>
      {snaps.map((s) => (
        <div className="card" key={s.id} style={{ marginBottom: 8 }}>
          <div className="spread">
            <div>
              <strong style={{ fontSize: 13 }}>#{s.id}</strong>
              {s.is_current && <span className="pill" style={{ marginLeft: 8, color: 'var(--ok)' }}>current</span>}
              <div className="hint">
                {new Date(s.created_at).toLocaleString()} · {(s.payload.projects || []).length} projects
              </div>
            </div>
            <span className="hint">{s.note || ''}</span>
          </div>
        </div>
      ))}
      {!snaps.length && <p className="hint">No publishes yet.</p>}
    </>
  )
}
