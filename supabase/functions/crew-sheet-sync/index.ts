// ─── Crew tracker Google Sheet sync ───────────────────────────────────────────
//
// Reads the production's crew-tracker Google Sheet server-side using a Google
// service account (the sheet stays private — it is shared with the service
// account's email like with any person) and returns the raw grid in two
// renders:
//   values   — UNFORMATTED_VALUE (dates arrive as serial numbers)
//   formulas — FORMULA (lets the client treat calculated cells as non-overrides)
// The client parses it with the same template logic as the Excel upload and
// shows the same diff-approval modal.
//
// Secrets:
//   GOOGLE_SA_KEY — the service account's full JSON key file
//
// Caller must be owner/admin of the production (or the app owner), matching
// send-invite: the sheet holds rates, which plain members may be denied.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const b64url = (buf: ArrayBuffer | string) => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// RS256-signed JWT for Google's OAuth2 service-account flow.
async function googleAccessToken(saEmail: string, privateKeyPem: string): Promise<string> {
  const pem = privateKeyPem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss:   saEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`))
  const jwt = `${header}.${payload}.${b64url(sig)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  if (!data.access_token) throw new Error('Google token exchange returned no access token')
  return data.access_token
}

// Accepts a full Google Sheets URL or a bare spreadsheet id.
function extractSheetId(input: string): string | null {
  const s = String(input ?? '').trim()
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── Caller auth ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await callerClient.auth.getUser()
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { productionId } = await req.json()
    if (!productionId) return json({ error: 'Missing productionId' }, 400)

    // ── Caller must be owner/admin of the production, or the app owner ──────
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const [{ data: membership }, { data: callerProfile }] = await Promise.all([
      adminClient.from('production_members').select('role')
        .eq('production_id', productionId).eq('user_id', user.id).maybeSingle(),
      adminClient.from('profiles').select('is_owner').eq('id', user.id).maybeSingle(),
    ])
    const isAppOwner = callerProfile?.is_owner === true
    if (!isAppOwner && !['owner', 'admin'].includes(membership?.role ?? '')) {
      return json({ error: 'Only production owners/admins can sync the crew sheet.' }, 403)
    }

    // ── Resolve the sheet ───────────────────────────────────────────────────
    const { data: prod, error: prodError } = await adminClient
      .from('production').select('crew_sheet_url').eq('id', productionId).maybeSingle()
    if (prodError) throw prodError
    const sheetId = extractSheetId(prod?.crew_sheet_url ?? '')
    if (!sheetId) {
      return json({ error: 'No Google Sheet link is saved for this production yet.' }, 400)
    }

    // ── Google service account ──────────────────────────────────────────────
    const saKeyRaw = Deno.env.get('GOOGLE_SA_KEY') ?? ''
    if (!saKeyRaw) return json({ error: 'GOOGLE_SA_KEY secret is not configured.' }, 500)
    let sa: { client_email?: string; private_key?: string }
    try { sa = JSON.parse(saKeyRaw) } catch {
      return json({ error: 'GOOGLE_SA_KEY secret is not valid JSON.' }, 500)
    }
    if (!sa.client_email || !sa.private_key) {
      return json({ error: 'GOOGLE_SA_KEY is missing client_email / private_key.' }, 500)
    }

    const token = await googleAccessToken(sa.client_email, sa.private_key)

    const range = 'A1:AA3000'   // first sheet; template columns run A–AA
    const fetchRange = async (render: string) => {
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=${render}&dateTimeRenderOption=SERIAL_NUMBER`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.status === 403) throw new Error('Google says access denied — share the sheet with the service account email (Viewer is enough).')
      if (res.status === 404) throw new Error('Sheet not found — check the saved link.')
      if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`)
      const data = await res.json()
      return data.values ?? []
    }

    const [values, formulas] = await Promise.all([
      fetchRange('UNFORMATTED_VALUE'),
      fetchRange('FORMULA'),
    ])

    return json({ ok: true, values, formulas, serviceAccount: sa.client_email })
  } catch (err) {
    console.error('[crew-sheet-sync]', err)
    return json({ error: String((err as Error)?.message ?? err) }, 500)
  }
})
