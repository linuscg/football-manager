import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function AcceptInvite({ token, session }) {
  const [invite,          setInvite]          = useState(null)
  const [existingProfile, setExistingProfile] = useState(null) // null = unknown, false = none, obj = found
  const [loadingInvite,   setLoadingInvite]   = useState(true)
  const [inviteError,     setInviteError]     = useState(null)

  // New-user fields
  const [firstName,       setFirstName]       = useState('')
  const [lastName,        setLastName]        = useState('')
  const [password,        setPassword]        = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [formError,  setFormError]  = useState(null)
  const [done,       setDone]       = useState(false)

  // ── Load invite + check for existing profile ────────────────────────────────
  useEffect(() => {
    async function load() {
      // 1. Validate the invite token
      const { data, error } = await supabase
        .from('invites')
        .select('*, production(name)')
        .eq('token', token)
        .eq('accepted', false)
        .gte('expires_at', new Date().toISOString())
        .maybeSingle()

      if (error || !data) {
        setInviteError('This invite link is invalid or has already been used.')
        setLoadingInvite(false)
        return
      }
      if (data.email.toLowerCase() !== session.user.email?.toLowerCase()) {
        setInviteError(
          `This invite was sent to ${data.email}. You are signed in as ${session.user.email}.`
        )
        setLoadingInvite(false)
        return
      }

      setInvite(data)

      // 2. Check if this user already has a profile (i.e. existing account)
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', session.user.id)
        .maybeSingle()

      setExistingProfile(profile ?? false)
      setLoadingInvite(false)
    }
    load()
  }, [token, session])

  // ── Add to production (shared by both paths) ────────────────────────────────
  async function addToProduction() {
    const { error: memberError } = await supabase
      .from('production_members')
      .insert({
        production_id: invite.production_id,
        user_id:       session.user.id,
        role:          invite.role,
      })
    if (memberError) throw new Error(memberError.message)

    await supabase.from('invites').update({ accepted: true }).eq('token', token)
  }

  // ── Existing user: one-click join ────────────────────────────────────────────
  async function handleJoin() {
    setSubmitting(true)
    setFormError(null)
    try {
      await addToProduction()
      setDone(true)
      setTimeout(() => window.location.replace(window.location.pathname), 1800)
    } catch (err) {
      setFormError(err.message)
    }
    setSubmitting(false)
  }

  // ── New user: full account setup ────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setFormError(null)

    if (!firstName.trim() || !lastName.trim()) {
      setFormError('Please enter your first and last name.')
      return
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (password !== passwordConfirm) {
      setFormError('Passwords do not match.')
      return
    }

    setSubmitting(true)

    // 1. Set password
    const { error: pwError } = await supabase.auth.updateUser({ password })
    if (pwError) { setFormError(pwError.message); setSubmitting(false); return }

    // 2. Upsert profile
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id: session.user.id, first_name: firstName.trim(), last_name: lastName.trim(), is_owner: false }, { onConflict: 'id' })
    if (profileError) { setFormError(profileError.message); setSubmitting(false); return }

    // 3. Add to production + mark invite accepted
    try {
      await addToProduction()
    } catch (err) {
      setFormError(err.message)
      setSubmitting(false)
      return
    }

    setDone(true)
    setSubmitting(false)
    setTimeout(() => window.location.replace(window.location.pathname), 1800)
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loadingInvite) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div className="login-logo">
            <img src="/favicon.svg" alt="FM" className="login-logo-img" />
          </div>
          <p className="login-sub" style={{ marginTop: 16 }}>Verifying your invitation…</p>
        </div>
      </div>
    )
  }

  // ── Invalid invite ────────────────────────────────────────────────────────────
  if (inviteError) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div className="login-logo">
            <img src="/favicon.svg" alt="FM" className="login-logo-img" />
          </div>
          <h1 className="login-title" style={{ fontSize: 18 }}>Invite Not Found</h1>
          <div className="login-error" style={{ marginTop: 20, textAlign: 'left' }}>{inviteError}</div>
          <p style={{ marginTop: 20, fontSize: 12, color: '#9ca3af' }}>
            Contact the person who sent you the invite to request a new link.
          </p>
        </div>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
          <h1 className="login-title" style={{ fontSize: 20 }}>You're all set!</h1>
          <p className="login-sub">Taking you to {invite.production?.name || 'the app'}…</p>
        </div>
      </div>
    )
  }

  const productionName = invite?.production?.name || 'the production'
  const roleLabel      = invite ? invite.role.charAt(0).toUpperCase() + invite.role.slice(1) : ''

  // ── EXISTING USER — one-click join ────────────────────────────────────────────
  if (existingProfile) {
    const name = [existingProfile.first_name, existingProfile.last_name].filter(Boolean).join(' ')
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-logo">
            <img src="/favicon.svg" alt="FM" className="login-logo-img" />
          </div>
          <h1 className="login-title">You've been invited</h1>
          <p className="login-sub">
            {name && <><strong>{name}</strong> · </>}
            {session.user.email}
          </p>

          <div style={{
            background: '#f0f7ff',
            border: '1px solid #bfdbfe',
            borderRadius: 10,
            padding: '16px 20px',
            margin: '24px 0',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>You've been invited to join</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{productionName}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>as <strong>{roleLabel}</strong></div>
          </div>

          {formError && <div className="login-error" style={{ marginBottom: 16 }}>{formError}</div>}

          <button
            className="login-btn"
            onClick={handleJoin}
            disabled={submitting}
          >
            {submitting ? 'Joining…' : `Join ${productionName}`}
          </button>

          <p style={{ marginTop: 16, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
            Your existing account and password are unchanged.
          </p>
        </div>
      </div>
    )
  }

  // ── NEW USER — full account setup ─────────────────────────────────────────────
  return (
    <div className="login-wrap">
      <div className="login-card">

        <div className="login-logo">
          <img src="/favicon.svg" alt="FM" className="login-logo-img" />
        </div>

        <h1 className="login-title">Welcome to Football Manager</h1>
        <p className="login-sub">
          You've been invited to <strong>{productionName}</strong> as <strong>{roleLabel}</strong>.
          <br />Set up your account to get started.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>

          <div className="login-field">
            <label className="login-label">First name</label>
            <input
              className="login-input"
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Jane"
              autoFocus
              required
            />
          </div>
          <div className="login-field">
            <label className="login-label">Last name</label>
            <input
              className="login-input"
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Smith"
              required
            />
          </div>

          <div className="login-field" style={{ marginTop: 4 }}>
            <label className="login-label">Email</label>
            <input
              className="login-input"
              type="email"
              value={session.user.email ?? ''}
              readOnly
              style={{ background: '#f9fafb', color: '#6b7280', cursor: 'default' }}
            />
          </div>

          <div className="login-field">
            <label className="login-label">Set a password</label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
            />
          </div>

          <div className="login-field">
            <label className="login-label">Confirm password</label>
            <input
              className="login-input"
              type="password"
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
          </div>

          {formError && (
            <div className="login-error">{formError}</div>
          )}

          <button
            className="login-btn"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Setting up your account…' : 'Create account & join'}
          </button>

        </form>
      </div>
    </div>
  )
}
