import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// /oauth/consent?authorization_id=… — Supabase Auth's OAuth 2.1 server sends
// the user here when Claude / ChatGPT (or another MCP client) asks to connect
// to Football Manager. The user is already signed in (App shows Login first
// and keeps this URL); we show who's asking and what it can do, then approve
// or deny and hand the browser back to the client.
export default function OAuthConsent({ session, signOut }) {
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id')
  const [details, setDetails] = useState(null)
  const [error, setError] = useState(authorizationId ? null : 'This link is missing its authorization id — start the connection again from Claude or ChatGPT.')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!authorizationId) return
    let cancelled = false
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: e }) => {
      if (cancelled) return
      if (e) { setError(e.message); return }
      // Already approved before → Supabase returns where to send the user.
      if (data && !('authorization_id' in data) && data.redirect_url) {
        window.location.assign(data.redirect_url)
        return
      }
      setDetails(data)
    })
    return () => { cancelled = true }
  }, [authorizationId])

  async function decide(approve) {
    setBusy(true)
    const fn = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization
    const { data, error: e } = await fn.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true })
    if (e) { setError(e.message); setBusy(false); return }
    window.location.assign(data.redirect_url)
  }

  const clientName = details?.client?.name || 'An AI assistant'
  let host = ''
  try { host = details?.redirect_uri ? new URL(details.redirect_uri).host : '' } catch { /* bad uri */ }

  return (
    <div className="login-wrap">
      <div className="login-card oauth-card">
        <div className="oauth-logos">
          {details?.client?.logo_uri
            ? <img src={details.client.logo_uri} alt="" className="oauth-logo" />
            : <div className="oauth-logo oauth-logo--blank">AI</div>}
          <span className="oauth-link">⇄</span>
          <img src="/favicon.svg" alt="Football Manager" className="oauth-logo" />
        </div>

        {error ? (
          <>
            <h1 className="login-title">Can&rsquo;t connect</h1>
            <div className="login-error">{error}</div>
            <a className="oauth-switch" href="/">Go to Football Manager</a>
          </>
        ) : !details ? (
          <p className="login-sub">Loading…</p>
        ) : (
          <>
            <h1 className="login-title">Connect {clientName}?</h1>
            <p className="login-sub">
              <strong>{clientName}</strong>{host && <> ({host})</>} wants to access Football Manager as{' '}
              <strong>{session.user.email}</strong>.
            </p>

            <ul className="oauth-list">
              <li>Read your productions&rsquo; schedule, scenes, cast, crew tracker, equipment, transport log and accommodation.</li>
              <li>Uses <strong>your</strong> permissions — it can only see what you can see in the app (hidden tabs and rates stay hidden).</li>
              <li><strong>Read-only for now</strong> — it can&rsquo;t add, change or delete anything.</li>
              <li>You can disconnect it at any time from Admin → Account.</li>
            </ul>

            <div className="oauth-actions">
              <button className="login-btn" disabled={busy} onClick={() => decide(true)}>
                {busy ? 'Connecting…' : `Allow ${clientName}`}
              </button>
              <button className="oauth-deny" disabled={busy} onClick={() => decide(false)}>Deny</button>
            </div>
            <button className="oauth-switch" onClick={signOut}>Not you? Sign in as someone else</button>
          </>
        )}
      </div>
    </div>
  )
}
