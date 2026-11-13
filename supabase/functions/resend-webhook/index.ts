// ─── Resend delivery webhook ──────────────────────────────────────────────────
// Resend calls this (configured in the Resend dashboard → Webhooks) when an
// email is delivered. We match the email id against the ids stored on
// new_starter_status when welcome / deal-memo emails were sent, and flip the
// corresponding Delivered dot automatically.
//
// Deployed with --no-verify-jwt (Resend sends no Supabase JWT); authenticity
// is verified via the svix signature with RESEND_WEBHOOK_SECRET instead.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? ''

async function verifySvix(req: Request, payload: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false
  const id = req.headers.get('svix-id') ?? ''
  const timestamp = req.headers.get('svix-timestamp') ?? ''
  const signature = req.headers.get('svix-signature') ?? ''
  if (!id || !timestamp || !signature) return false
  // Reject stale timestamps (5 min window) to block replays.
  const ts = parseInt(timestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  const secret = WEBHOOK_SECRET.startsWith('whsec_') ? WEBHOOK_SECRET.slice(6) : WEBHOOK_SECRET
  const key = await crypto.subtle.importKey(
    'raw', Uint8Array.from(atob(secret), c => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signed = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
  )
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)))
  // Header holds space-separated "v1,<sig>" entries.
  return signature.split(' ').some(part => {
    const [, sig] = part.split(',')
    return sig === expected
  })
}

serve(async (req) => {
  try {
    const payload = await req.text()
    if (!(await verifySvix(req, payload))) {
      return new Response('invalid signature', { status: 401 })
    }

    const event = JSON.parse(payload)
    if (event?.type !== 'email.delivered') {
      return new Response('ignored', { status: 200 })
    }
    const emailId = String(event?.data?.email_id ?? '')
    if (!emailId) return new Response('no email id', { status: 200 })

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const [l, a, b] = await Promise.all([
      adminClient.from('welcome_email_log')
        .update({ delivered: true })
        .eq('resend_id', emailId)
        .select('id'),
      adminClient.from('new_starter_status')
        .update({ email_delivered: true })
        .eq('welcome_email_id', emailId)
        .select('id'),
      adminClient.from('new_starter_status')
        .update({ memo_delivered: true })
        .eq('memo_email_id', emailId)
        .select('id'),
    ])
    const n = (a.data?.length ?? 0) + (b.data?.length ?? 0)
    return new Response(`ok (${n} updated)`, { status: 200 })
  } catch (err) {
    console.error('[resend-webhook]', err)
    return new Response('error', { status: 500 })
  }
})
