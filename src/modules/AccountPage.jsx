import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const MCP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fm-mcp`

// Claude / ChatGPT connector: the MCP server URL, how to add it, and the
// assistants this user has already connected (OAuth grants) with Disconnect.
function AiAssistants() {
  const [grants, setGrants] = useState(null)   // null = loading / unavailable
  const [copied, setCopied] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  async function loadGrants() {
    const { data, error: e } = await supabase.auth.oauth.listGrants()
    setGrants(e ? null : (data ?? []))
  }
  useEffect(() => { loadGrants() }, [])

  async function copy() {
    try { await navigator.clipboard.writeText(MCP_URL); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }
  async function disconnect(g) {
    if (!window.confirm(`Disconnect ${g.client?.name || 'this assistant'}? It will lose access to Football Manager straight away.`)) return
    setBusyId(g.client.id)
    const { error: e } = await supabase.auth.oauth.revokeGrant({ clientId: g.client.id })
    setBusyId(null)
    if (e) setError(e.message)
    else loadGrants()
  }

  return (
    <div className="acct-section">
      <h2 className="acct-section-title">AI assistants</h2>
      <p className="acct-section-sub">
        Connect Claude or ChatGPT to ask about your productions in plain English — &ldquo;who&rsquo;s starting on Monday?&rdquo;,
        &ldquo;what&rsquo;s shooting next week?&rdquo;, &ldquo;how much has Art Dept spent on transport?&rdquo;. It signs in as you and
        sees only what you can see. <strong>Read-only for now.</strong>
      </p>

      <label className="acct-label">Connector URL</label>
      <div className="ai-url-row">
        <input className="acct-input acct-input--readonly ai-url" readOnly value={MCP_URL} onFocus={e => e.target.select()} />
        <button className="acct-btn acct-btn--secondary" type="button" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>

      <div className="ai-steps">
        <div>
          <div className="ai-steps-title">Claude</div>
          <ol>
            <li>Settings → Connectors → <em>Add custom connector</em></li>
            <li>Name it &ldquo;Football Manager&rdquo; and paste the URL above</li>
            <li>Click Connect, sign in, and choose Allow</li>
          </ol>
        </div>
        <div>
          <div className="ai-steps-title">ChatGPT</div>
          <ol>
            <li>Settings → Apps &amp; Connectors → Advanced → turn on <em>Developer mode</em></li>
            <li>Create a connector, paste the URL above, authentication OAuth</li>
            <li>Connect, sign in, and choose Allow</li>
          </ol>
        </div>
      </div>

      {error && <div className="acct-error">{error}</div>}
      {grants && (
        <>
          <label className="acct-label">Connected</label>
          {grants.length === 0 ? <p className="acct-hint">No assistants connected yet.</p> : (
            <div className="ai-grants">
              {grants.map(g => (
                <div key={g.client.id} className="ai-grant">
                  {g.client.logo_uri ? <img src={g.client.logo_uri} alt="" className="ai-grant-logo" /> : <div className="ai-grant-logo ai-grant-logo--blank">AI</div>}
                  <div className="ai-grant-main">
                    <div className="ai-grant-name">{g.client.name || 'Unnamed assistant'}</div>
                    <div className="acct-hint">Connected {new Date(g.granted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                  </div>
                  <button className="acct-btn acct-btn--secondary" type="button" disabled={busyId === g.client.id} onClick={() => disconnect(g)}>
                    {busyId === g.client.id ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function AccountPage({ session, profile, onUpdateProfile }) {
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)
  const [nameError, setNameError] = useState(null)

  const [pwSending,  setPwSending]  = useState(false)
  const [pwSent,     setPwSent]     = useState(false)
  const [pwError,    setPwError]    = useState(null)

  // Sync fields when profile loads
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name ?? '')
      setLastName(profile.last_name ?? '')
    }
  }, [profile])

  // ── Save name ───────────────────────────────────────────────────────────────
  async function handleSaveName(e) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) {
      setNameError('Please enter both first and last name.')
      return
    }
    setSaving(true)
    setNameError(null)
    setSaved(false)
    const { error } = await onUpdateProfile({
      first_name: firstName.trim(),
      last_name:  lastName.trim(),
    })
    if (error) {
      setNameError(error.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
    setSaving(false)
  }

  // ── Send password reset email ────────────────────────────────────────────────
  async function handleResetPassword() {
    setPwSending(true)
    setPwError(null)
    setPwSent(false)
    const { error } = await supabase.auth.resetPasswordForEmail(
      session.user.email,
      { redirectTo: `${window.location.origin}/` }
    )
    if (error) {
      setPwError(error.message)
    } else {
      setPwSent(true)
    }
    setPwSending(false)
  }

  const isDirty = profile
    ? firstName !== (profile.first_name ?? '') || lastName !== (profile.last_name ?? '')
    : false

  return (
    <div className="acct-wrap">
      <div className="acct-section">
        <h2 className="acct-section-title">Your Details</h2>
        <p className="acct-section-sub">Update your name as it appears in the app.</p>

        <form className="acct-form" onSubmit={handleSaveName}>
          <div className="acct-row">
            <div className="acct-field">
              <label className="acct-label">First name</label>
              <input
                className="acct-input"
                type="text"
                value={firstName}
                onChange={e => { setFirstName(e.target.value); setSaved(false) }}
                placeholder="Jane"
                required
              />
            </div>
            <div className="acct-field">
              <label className="acct-label">Last name</label>
              <input
                className="acct-input"
                type="text"
                value={lastName}
                onChange={e => { setLastName(e.target.value); setSaved(false) }}
                placeholder="Smith"
                required
              />
            </div>
          </div>

          <div className="acct-field">
            <label className="acct-label">Email</label>
            <input
              className="acct-input acct-input--readonly"
              type="email"
              value={session.user.email ?? ''}
              readOnly
            />
            <p className="acct-hint">Email is managed through Supabase Auth and cannot be changed here.</p>
          </div>

          {nameError && <div className="acct-error">{nameError}</div>}

          <div className="acct-actions">
            <button
              className="acct-btn"
              type="submit"
              disabled={saving || !isDirty}
            >
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>

      <div className="acct-divider" />

      <div className="acct-section">
        <h2 className="acct-section-title">Password</h2>
        <p className="acct-section-sub">
          We'll send a password reset link to <strong>{session.user.email}</strong>.
        </p>

        {pwError  && <div className="acct-error">{pwError}</div>}
        {pwSent   && (
          <div className="acct-success">
            Reset email sent — check your inbox.
          </div>
        )}

        <button
          className="acct-btn acct-btn--secondary"
          onClick={handleResetPassword}
          disabled={pwSending || pwSent}
          type="button"
        >
          {pwSending ? 'Sending…' : pwSent ? '✓ Email sent' : 'Send password reset email'}
        </button>
      </div>

      <div className="acct-divider" />

      <AiAssistants />
    </div>
  )
}
