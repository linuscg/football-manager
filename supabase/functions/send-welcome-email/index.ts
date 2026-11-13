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
    const reqBody = await req.json()
    const { to, subject, text, attachments, productionId } = reqBody

    if (reqBody.action !== 'send-report' && (!to || !subject || !productionId)) {
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

    // ── Delivery-report action ──────────────────────────────────────────────
    // Called by the app ~30s after a batch of welcome emails goes out: looks
    // up each email's latest Resend event and emails ONE combined confirmation
    // to the person who sent them.
    if (reqBody.action === 'send-report') {
      const items = (Array.isArray(reqBody.items) ? reqBody.items : []).slice(0, 50)
      if (!items.length || !user.email) {
        return new Response(JSON.stringify({ error: 'Nothing to report.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const LABELS: Record<string, string> = {
        delivered:        '✅ Delivered',
        sent:             '📤 Sent — delivery not confirmed yet',
        delivery_delayed: '⏳ Delayed — still trying',
        bounced:          '❌ Bounced — check the address',
        complained:       '⚠️ Marked as spam by the recipient',
      }
      const results: Array<{ name: string; email: string; status: string }> = []
      for (const it of items) {
        let status = 'unknown'
        const id = String(it?.resendId ?? '')
        if (/^[0-9a-f-]{20,}$/i.test(id)) {
          try {
            const r = await fetch(`https://api.resend.com/emails/${id}`, {
              headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
            })
            if (r.ok) status = (await r.json()).last_event ?? 'sent'
          } catch { /* keep unknown */ }
        }
        results.push({ name: String(it?.name ?? ''), email: String(it?.email ?? ''), status })
      }
      const { data: prodRow2 } = await adminClient
        .from('production').select('name').eq('id', productionId).maybeSingle()
      const prodName2 = String(prodRow2?.name ?? '')
        .replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
      const delivered = results.filter(r => r.status === 'delivered').length
      const rowsHtml = results.map(r => `
        <tr>
          <td style="padding:6px 14px 6px 0;font-weight:600;">${escapeHtml(r.name)}</td>
          <td style="padding:6px 14px 6px 0;color:#555;">${escapeHtml(r.email)}</td>
          <td style="padding:6px 0;">${escapeHtml(LABELS[r.status] ?? `Status: ${r.status}`)}</td>
        </tr>`).join('')
      const html = `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#111;max-width:640px;">
          <h2 style="margin:0 0 4px;">Welcome emails sent</h2>
          <p style="margin:0 0 12px;color:#555;">
            ${results.length} welcome email${results.length === 1 ? '' : 's'} sent${prodName2 ? ` on ${escapeHtml(prodName2)}` : ''} —
            ${delivered} confirmed delivered so far.
          </p>
          <table style="border-collapse:collapse;font-size:14px;">
            <tr>
              <th align="left" style="padding:4px 14px 4px 0;color:#888;font-size:12px;">PERSON</th>
              <th align="left" style="padding:4px 14px 4px 0;color:#888;font-size:12px;">SENT TO</th>
              <th align="left" style="padding:4px 0;color:#888;font-size:12px;">STATUS</th>
            </tr>
            ${rowsHtml}
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#999;">
            Statuses were checked ~30 seconds after sending; the Delivered dots in
            New Starters keep updating automatically as the rest land.
          </p>
        </div>`
      const fromName = prodName2 ? `${prodName2} <noreply@footballmanager.xyz>` : FROM_ADDRESS
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromName,
          to: [user.email],
          subject: `Welcome emails: ${results.length} sent, ${delivered} delivered${prodName2 ? ` — ${prodName2}` : ''}`,
          html,
        }),
      })
      if (!sendRes.ok) {
        return new Response(JSON.stringify({ error: `Report email failed: ${await sendRes.text()}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ ok: true, delivered, total: results.length }), {
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
    // The caller may always email THEMSELVES (test sends of the welcome email).
    const callerEmail = String(user.email ?? '').toLowerCase().trim()
    const unknown = recipients.filter(e => !known.has(e) && e !== callerEmail)
    if (unknown.length) {
      console.error('send-welcome-email: recipient not in production crew', unknown)
      return new Response(JSON.stringify({ error: `Not crew emails on this production: ${unknown.join(', ')}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // From display name = the production's name (address stays on the
    // verified footballmanager.xyz domain). Quotes/newlines are stripped so a
    // production name can't smuggle extra headers or a fake address in.
    const { data: prodRow } = await adminClient
      .from('production')
      .select('name')
      .eq('id', productionId)
      .maybeSingle()
    const prodName = String(prodRow?.name ?? '')
      .replace(/[\r\n"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    const fromAddress = prodName ? `${prodName} <noreply@footballmanager.xyz>` : FROM_ADDRESS

    const payload: Record<string, unknown> = {
      from: fromAddress,
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
