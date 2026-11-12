// ─── Equipment off-hire reminders ─────────────────────────────────────────────
//
// Two actions in one function:
//
//   { action: 'subscribe', resourceId, enable }   (user JWT)
//     Toggles off-hire reminders for one equipment resource. Enabling stores
//     the caller's email on the row (RLS enforces production membership) and
//     sends an immediate confirmation email with a calendar invite (.ics) for
//     the off-hire date.
//
//   { action: 'sweep', secret }                   (daily pg_cron job)
//     Finds every subscribed machine whose hire_end_date is tomorrow or
//     exactly one week away, groups them per recipient, and sends ONE email
//     per recipient listing all of them. Guarded by CRON_SECRET.
//
// Emails go through Resend, same as send-invite / send-welcome-email.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET    = Deno.env.get('CRON_SECRET') ?? ''
const FROM_ADDRESS   = 'Football Manager <noreply@footballmanager.xyz>'

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

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
    })
  } catch { return iso }
}

// All-day calendar event for the off-hire date, with a 1-day display alarm.
function buildIcs(resource: { id: string; name: string; vendor: string; po_number: string; hire_end_date: string }): string {
  const d = resource.hire_end_date.replaceAll('-', '')
  const next = new Date(resource.hire_end_date + 'T00:00:00Z')
  next.setUTCDate(next.getUTCDate() + 1)
  const dEnd = next.toISOString().slice(0, 10).replaceAll('-', '')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const esc = (s: string) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const descParts = [
    resource.vendor ? `Supplier: ${resource.vendor}` : '',
    resource.po_number ? `PO: ${resource.po_number}` : '',
    'Arrange return / collection.',
  ].filter(Boolean).join('\\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Football Manager//Off-hire//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:offhire-${resource.id}@footballmanager.xyz`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${dEnd}`,
    `SUMMARY:Off-hire: ${esc(resource.name)}`,
    `DESCRIPTION:${descParts}`,
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:Off-hire tomorrow: ${esc(resource.name)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

async function sendEmail(to: string, subject: string, html: string, icsContent?: string) {
  const payload: Record<string, unknown> = { from: FROM_ADDRESS, to: [to], subject, html }
  if (icsContent) {
    payload.attachments = [{
      filename: 'off-hire.ics',
      content: btoa(unescape(encodeURIComponent(icsContent))),
      content_type: 'text/calendar',
    }]
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
}

function machineRows(list: Array<{ name: string; vendor: string; po_number: string; hire_end_date: string; productionName: string }>): string {
  return list.map(m => `
    <tr>
      <td style="padding:6px 12px 6px 0;font-weight:600;">${escapeHtml(m.name)}</td>
      <td style="padding:6px 12px 6px 0;color:#555;">${escapeHtml(m.vendor || '—')}</td>
      <td style="padding:6px 12px 6px 0;color:#555;">${escapeHtml(m.po_number || '—')}</td>
      <td style="padding:6px 0;color:#555;">${escapeHtml(m.productionName)}</td>
    </tr>`).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Daily sweep (pg_cron) ───────────────────────────────────────────────
    if (body.action === 'sweep') {
      if (!CRON_SECRET || body.secret !== CRON_SECRET) return json({ error: 'Forbidden' }, 403)

      const today = new Date()
      const plus = (n: number) => {
        const d = new Date(today); d.setUTCDate(d.getUTCDate() + n)
        return d.toISOString().slice(0, 10)
      }
      const d1 = plus(1), d7 = plus(7)

      const { data: rows, error } = await adminClient
        .from('resources')
        .select('id, name, vendor, po_number, hire_end_date, offhire_reminder_email, production:production_id(name)')
        .eq('type', 'equipment')
        .not('offhire_reminder_email', 'is', null)
        .in('hire_end_date', [d1, d7])
      if (error) throw error

      // Group per recipient — one email each, tomorrow + one-week sections.
      const byEmail = new Map<string, { tomorrow: any[]; week: any[] }>()
      for (const r of rows ?? []) {
        const email = String(r.offhire_reminder_email ?? '').trim().toLowerCase()
        if (!email) continue
        if (!byEmail.has(email)) byEmail.set(email, { tomorrow: [], week: [] })
        const entry = { ...r, productionName: (r as any).production?.name ?? '' }
        if (r.hire_end_date === d1) byEmail.get(email)!.tomorrow.push(entry)
        else byEmail.get(email)!.week.push(entry)
      }

      let sent = 0
      for (const [email, { tomorrow, week }] of byEmail) {
        const total = tomorrow.length + week.length
        const subject = tomorrow.length
          ? `Off-hire tomorrow: ${tomorrow.length === 1 ? tomorrow[0].name : `${tomorrow.length} machines`}`
          : `Off-hire in one week: ${week.length === 1 ? week[0].name : `${week.length} machines`}`
        const section = (title: string, date: string, list: any[]) => list.length ? `
          <h3 style="margin:18px 0 6px;font-size:15px;">${title} — ${escapeHtml(fmtDate(date))}</h3>
          <table style="border-collapse:collapse;font-size:14px;">
            <tr>
              <th align="left" style="padding:4px 12px 4px 0;color:#888;font-size:12px;">MACHINE</th>
              <th align="left" style="padding:4px 12px 4px 0;color:#888;font-size:12px;">SUPPLIER</th>
              <th align="left" style="padding:4px 12px 4px 0;color:#888;font-size:12px;">PO #</th>
              <th align="left" style="padding:4px 0;color:#888;font-size:12px;">PRODUCTION</th>
            </tr>
            ${machineRows(list)}
          </table>` : ''
        const html = `
          <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#111;max-width:640px;">
            <h2 style="margin:0 0 4px;">Equipment off-hire reminder</h2>
            <p style="margin:0 0 8px;color:#555;">${total} machine${total === 1 ? ' is' : 's are'} coming off hire soon — arrange returns / collections.</p>
            ${section('Off-hire TOMORROW', d1, tomorrow)}
            ${section('Off-hire in one week', d7, week)}
            <p style="margin:18px 0 0;font-size:12px;color:#999;">You get these because you requested off-hire reminders in Football Manager. Untoggle the bell on the machine to stop.</p>
          </div>`
        await sendEmail(email, subject, html)
        sent++
      }
      return json({ ok: true, recipients: sent, machines: (rows ?? []).length })
    }

    // ── Subscribe / unsubscribe (user JWT) ──────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await callerClient.auth.getUser()
    if (authError || !user?.email) return json({ error: 'Unauthorized' }, 401)

    const { action, resourceId, enable } = body
    if (action !== 'subscribe' || !resourceId) return json({ error: 'Bad request' }, 400)

    // RLS on this update enforces production membership — a non-member's
    // update matches zero rows and `updated` comes back empty.
    const { data: updated, error: updError } = await callerClient
      .from('resources')
      .update({ offhire_reminder_email: enable ? user.email.toLowerCase() : null })
      .eq('id', resourceId)
      .eq('type', 'equipment')
      .select('id, name, vendor, po_number, hire_end_date')
      .maybeSingle()
    if (updError) throw updError
    if (!updated) return json({ error: 'Machine not found (or no access).' }, 404)

    if (enable && updated.hire_end_date) {
      const ics = buildIcs(updated)
      const html = `
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;color:#111;max-width:640px;">
          <h2 style="margin:0 0 4px;">Off-hire reminder set</h2>
          <p style="margin:0 0 10px;">
            <strong>${escapeHtml(updated.name)}</strong> goes off hire on
            <strong>${escapeHtml(fmtDate(updated.hire_end_date))}</strong>.
          </p>
          <p style="margin:0 0 10px;color:#555;">
            ${updated.vendor ? `Supplier: ${escapeHtml(updated.vendor)} · ` : ''}
            ${updated.po_number ? `PO: ${escapeHtml(updated.po_number)}` : ''}
          </p>
          <p style="margin:0 0 10px;">The attached calendar invite blocks out the off-hire date.
            You'll also get a reminder email one week before and the day before
            (machines off-hiring the same day are grouped in one email).</p>
        </div>`
      await sendEmail(user.email, `Off-hire reminder set: ${updated.name}`, html, ics)
    }

    return json({ ok: true, enabled: !!enable, email: user.email })
  } catch (err) {
    console.error('[offhire-reminder]', err)
    return json({ error: String((err as Error)?.message ?? err) }, 500)
  }
})
