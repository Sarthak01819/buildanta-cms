import React, { useState } from 'react'
import { supabase } from './supabase.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('in')      // in | up
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setNote(''); setBusy(true)
    const fn = mode === 'in' ? 'signInWithPassword' : 'signUp'
    const { error } = await supabase.auth[fn]({ email, password })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (mode === 'up') {
      // The first account becomes owner (a trigger does it); every later one
      // lands as a viewer until an owner promotes them.
      setNote('Account created. If this is the first one, you are the owner.')
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1 style={{ marginTop: 0, fontSize: 16 }}>Buildanta admin</h1>
        <div className="field">
          <label>Email</label>
          <input type="text" value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        {err && <p className="err">{err}</p>}
        {note && <p className="ok">{note}</p>}
        <button className="btn btn--primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        <p className="hint" style={{ textAlign: 'center', marginTop: 12 }}>
          <button type="button" className="btn" style={{ background: 'none', border: 0, padding: 0 }}
            onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); setNote('') }}>
            {mode === 'in' ? 'Create an account' : 'I already have an account'}
          </button>
        </p>
      </form>
    </div>
  )
}
