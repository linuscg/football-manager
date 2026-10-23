import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_ADDRESS   = 'Football Manager <noreply@footballmanager.xyz>'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, subject, text, attachments, productionId } = await req.json()

    if (!to || !subject || !productionId) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, productionId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Caller must be a signed-in owner/admin of the production ───────────
    // Without this check the function is an open mail relay for the domain.
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: membership } = await adminClient
      .from('production_members')
      .select('role')
      .eq('production_id', productionId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      console.error('send-welcome-email: caller is not owner/admin', user.id, productionId, membership?.role)
      return new Response(JSON.stringify({ error: 'You do not have permission to send emails for this production.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Recipients must be crew contact emails of that production ──────────
    // Compared case/whitespace-insensitively in JS — stored emails may carry
    // capitals or stray spaces, which a SQL equality match would reject.
    const recipients = (Array.isArray(to) ? to : [to]).map(e => String(e).toLowerCase().trim())
    const { data: crewRows } = await adminClient
      .from('resources')
      .select('contact_email')
      .eq('production_id', productionId)
      .neq('contact_email', '')
    const known = new Set((crewRows ?? []).map(r => String(r.contact_email ?? '').toLowerCase().trim()))
    const unknown = recipients.filter(e => !known.has(e))
    if (unknown.length) {
      console.error('send-welcome-email: recipient not in production crew', unknown)
      return new Response(JSON.stringify({ error: `Not crew emails on this production: ${unknown.join(', ')}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload: Record<string, unknown> = {
      from: FROM_ADDRESS,
      to:   recipients,
      subject,
      text: text ?? '',
    }

    if (attachments && attachments.length > 0) {
      payload.attachments = attachments.map((a: { filename: string; content: string }) => ({
        filename: a.filename,
        content:  a.content,
      }))
    }

    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    if (!res.ok) console.error('send-welcome-email: resend error', res.status, JSON.stringify(data))

    return new Response(JSON.stringify(data), {
      status:  res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status:  500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
