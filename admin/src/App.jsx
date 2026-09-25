import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase.js'
import Login from './Login.jsx'
import Projects from './Projects.jsx'
import ProjectEditor from './ProjectEditor.jsx'
import MediaLibrary from './MediaLibrary.jsx'
import SiteContent from './SiteContent.jsx'
import Publish from './Publish.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [member, setMember] = useState(null)
  const [booting, setBooting] = useState(true)
  const [view, setView] = useState('projects')
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Signing in is not the same as being allowed in.
  //
  // Supabase auth will happily create an account for anyone who can reach the
  // page. Membership is the grant, and it is enforced by RLS — this lookup only
  // decides what the UI offers. A viewer who forged their way past this screen
  // would still be refused by the database on every write.
  const loadMember = useCallback(async (uid) => {
    const { data } = await supabase.from('members').select('*').eq('user_id', uid).maybeSingle()
    setMember(data || null)
  }, [])

  useEffect(() => {
    if (session?.user?.id) loadMember(session.user.id)
    else setMember(null)
  }, [session, loadMember])

  if (booting) return null
  if (!session) return <Login />

  if (!member) {
    return (
      <div className="login">
        <div className="card">
          <h1 style={{ marginTop: 0, fontSize: 16 }}>No access</h1>
          <p style={{ color: 'var(--dim)' }}>
            You are signed in as <strong>{session.user.email}</strong> but you are not a
            member of this workspace. An owner has to add you.
          </p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    )
  }

  const canWrite = member.role === 'owner' || member.role === 'editor'

  const open = (id) => { setEditing(id); setView('editor') }

  return (
    <div className="app">
      <aside className="side">
        <h1>Buildanta</h1>
        <div className="who">
          {session.user.email}<br />
          <span className="pill">{member.role}</span>
        </div>
        <nav className="nav">
          {[
            ['projects', 'Projects'],
            ['media', 'Media'],
            ['site', 'Site content'],
            ['publish', 'Publish']
          ].map(([k, label]) => (
            <button key={k} className={view === k ? 'on' : ''}
              onClick={() => { setView(k); setEditing(null) }}>{label}</button>
          ))}
        </nav>
        <div style={{ marginTop: 24 }}>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        {!canWrite && (
          <p className="hint" style={{ marginTop: 18 }}>
            You have read-only access. Everything is visible; nothing will save.
          </p>
        )}
      </aside>

      <main className="main">
        {view === 'projects' && <Projects canWrite={canWrite} onOpen={open} />}
        {view === 'editor' && <ProjectEditor id={editing} canWrite={canWrite}
          onDone={() => { setView('projects'); setEditing(null) }} />}
        {view === 'media' && <MediaLibrary canWrite={canWrite} />}
        {view === 'site' && <SiteContent canWrite={canWrite} />}
        {view === 'publish' && <Publish canWrite={canWrite} />}
      </main>
    </div>
  )
}
