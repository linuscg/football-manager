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
    scope: 'https://www.googleapis.com/auth/spreadsheets',
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

// ─── Template parsing (mirror of src/lib/crewXlsxImport.js, Deno port) ───────
// Used by the auto-sync sweep, which must parse server-side.

type Cell = { v: unknown; f?: string } | undefined

const sv = (c: Cell) => {
  if (!c || c.v === undefined || c.v === null) return ''
  if (typeof c.v === 'boolean') return c.v ? 'TRUE' : 'FALSE'
  return String(c.v).trim()
}
const nv = (c: Cell) => {
  if (!c || c.v === undefined || c.v === null) return null
  if (typeof c.v === 'number') return Number.isFinite(c.v) ? c.v : null
  if (typeof c.v === 'string') {
    const cleaned = c.v.replace(/[£$€,\s]/g, '')
    if (!cleaned) return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}
const ov = (c: Cell) => (!c || c.f ? null : (typeof c.v === 'number' && Number.isFinite(c.v) ? c.v : null))
const dv = (c: Cell) => {
  if (!c || c.v === undefined || c.v === null) return ''
  const v = c.v
  if (typeof v === 'number') {
    if (v > 32000 && v < 75000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }
    return ''
  }
  if (typeof v === 'string') {
    const s = v.trim()
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) return s
    m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
    if (m) {
      let y = Number(m[3]); if (m[3].length <= 2) y += 2000
      return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
    }
  }
  return ''
}

const SHEET_MATCHERS: Array<[string, (h: string) => boolean]> = [
  ['name',            h => h === 'name'],
  ['role',            h => h === 'role'],
  ['email',           h => h === 'email'],
  ['phone',           h => h === 'number' || h === 'phone'],
  ['agent',           h => h === 'agent'],
  ['weeklyRate',      h => h === 'weekly rate'],
  ['sixthOverride',   h => h === '6th day rate'],
  ['seventhOverride', h => h === '7th day rate'],
  ['otOverride',      h => h === 'ot rate'],
  ['boxPw',           h => h.startsWith('box')],
  ['carAllowance',    h => h === 'car' || h === 'car allowance'],
  ['taxStatus',       h => h === 'tax status' || h === 'tax'],
  ['startDate',       h => h === 'start date' || h === 'start'],
  ['endDate',         h => h === 'end date' || h === 'end'],
  ['dealMemoEmailed', h => h === 'email deal memo'],
  ['dealMemoDrafted', h => h === 'deal memo drafted'],
  ['dealMemoSent',    h => (h.includes('docusign') && h.includes('sent')) || h === 'deal memo sent'],
  ['dealMemoExecuted', h => h.includes('executed')],
  ['payrollForwarded', h => h.includes('forwarded to payroll')],
  ['teamEngine',      h => h === 'team engine'],
  ['shootCrew',       h => h === 'shoot crew'],
  ['rtwCheck',        h => h === 'rtw check' || h === 'rtw'],
]

// deno-lint-ignore no-explicit-any
function parsePeople(values: any[][], formulas: any[][]): any[] {
  const cell = (r: number, c: number): Cell => {
    const v = values?.[r]?.[c]
    if (v === undefined || v === null || v === '') return undefined
    const f = formulas?.[r]?.[c]
    return { v, f: typeof f === 'string' && f.startsWith('=') ? f : undefined }
  }
  const lastRow = (values?.length ?? 0) - 1
  const lastCol = Math.max(0, ...(values ?? []).map(r => r?.length ?? 0)) - 1

  let headerRow = -1
  const col: Record<string, number> = {}
  for (let r = 0; r <= Math.min(lastRow, 9); r++) {
    const labels: string[] = []
    for (let c = 0; c <= lastCol; c++) labels[c] = sv(cell(r, c)).toLowerCase().replace(/\?+$/, '').trim()
    if (!labels.includes('name') || !labels.includes('role') || !labels.includes('weekly rate')) continue
    headerRow = r
    for (const [key, match] of SHEET_MATCHERS) {
      const idx = labels.findIndex(h => h && match(h))
      if (idx >= 0) col[key] = idx
    }
    break
  }
  if (headerRow < 0) return []

  const at = (r: number, k: string): Cell => (col[k] === undefined ? undefined : cell(r, col[k]))
  const people = []
  let department = ''
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const name = sv(at(r, 'name'))
    if (!name) continue
    const role = sv(at(r, 'role'))
    if (!role) { department = name; continue }
    people.push({
      name, role, department,
      email: sv(at(r, 'email')), phone: sv(at(r, 'phone')), agent: sv(at(r, 'agent')),
      weeklyRate: nv(at(r, 'weeklyRate')),
      sixthOverride: ov(at(r, 'sixthOverride')), seventhOverride: ov(at(r, 'seventhOverride')), otOverride: ov(at(r, 'otOverride')),
      boxPw: nv(at(r, 'boxPw')), carAllowance: nv(at(r, 'carAllowance')),
      taxStatus: sv(at(r, 'taxStatus')), startDate: dv(at(r, 'startDate')), endDate: dv(at(r, 'endDate')),
      dealMemoEmailed: sv(at(r, 'dealMemoEmailed')), dealMemoDrafted: sv(at(r, 'dealMemoDrafted')),
      dealMemoSent: sv(at(r, 'dealMemoSent')), dealMemoExecuted: sv(at(r, 'dealMemoExecuted')),
      payrollForwarded: sv(at(r, 'payrollForwarded')), teamEngine: sv(at(r, 'teamEngine')),
      shootCrew: sv(at(r, 'shootCrew')), rtwCheck: sv(at(r, 'rtwCheck')),
    })
  }
  return people
}

// person field → resources column (text/date fields; empty sheet value never overwrites)
const RES_TEXT_COLS: Array<[string, string]> = [
  ['role', 'role'], ['department', 'department'], ['email', 'contact_email'],
  ['phone', 'contact_phone'], ['agent', 'agent'], ['taxStatus', 'tax_status'],
  ['dealMemoEmailed', 'deal_memo_emailed'], ['dealMemoDrafted', 'deal_memo_drafted'],
  ['dealMemoSent', 'deal_memo_sent'], ['dealMemoExecuted', 'deal_memo_executed'],
  ['payrollForwarded', 'payroll_forwarded'], ['teamEngine', 'team_engine'],
  ['shootCrew', 'shoot_crew'], ['rtwCheck', 'rtw_check'],
]
const RES_DATE_COLS: Array<[string, string]> = [['startDate', 'hire_start_date'], ['endDate', 'hire_end_date']]
const RATE_NUM_COLS: Array<[string, string]> = [
  ['sixthOverride', 'sixth_day_rate'], ['seventhOverride', 'seventh_day_rate'],
  ['otOverride', 'ot_rate'], ['boxPw', 'box_pw'], ['carAllowance', 'car_allowance'],
]

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()

    // ── Auto-sync sweep (pg_cron, every 2 min) ──────────────────────────────
    // For every production with a linked sheet, pulls the sheet and applies
    // changed values to rows flagged sheet_synced (matched by name). New
    // people are NOT auto-created — they wait for the manual sync's diff
    // modal — and empty sheet cells never overwrite app data.
    if (body.action === 'auto-sync') {
      const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
      if (!CRON_SECRET || body.secret !== CRON_SECRET) return json({ error: 'Forbidden' }, 403)

      const adminC = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const { data: prods, error: prodErr } = await adminC
        .from('production').select('id, crew_sheet_url').not('crew_sheet_url', 'is', null)
      if (prodErr) throw prodErr

      const saRaw = Deno.env.get('GOOGLE_SA_KEY') ?? ''
      const sa = JSON.parse(saRaw)
      let token: string | null = null
      const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
      const report: Record<string, unknown>[] = []

      for (const prod of prods ?? []) {
        const sheetId = extractSheetId(prod.crew_sheet_url ?? '')
        if (!sheetId) continue
        const { data: allCrew, error: resErr } = await adminC
          .from('resources')
          .select('id, name, sheet_synced, role, department, contact_email, contact_phone, agent, tax_status, hire_start_date, hire_end_date, deal_memo_emailed, deal_memo_drafted, deal_memo_sent, deal_memo_executed, payroll_forwarded, team_engine, shoot_crew, rtw_check, resource_rates(cost_amount, cost_type, sixth_day_rate, seventh_day_rate, ot_rate, box_pw, car_allowance)')
          .eq('production_id', prod.id).eq('type', 'crew')
        if (resErr) { report.push({ production: prod.id, error: resErr.message }); continue }
        const synced = (allCrew ?? []).filter(r => r.sheet_synced)
        if (!synced.length) continue   // auto-sync only runs once a manual sync has linked rows

        token ??= await googleAccessToken(sa.client_email, sa.private_key)
        const range = 'A1:ZZ3000'
        const grab = async (render: string) => {
          const res = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=${render}&dateTimeRenderOption=SERIAL_NUMBER`,
            { headers: { Authorization: `Bearer ${token}` } },
          )
          if (!res.ok) throw new Error(`Sheets ${res.status}`)
          return (await res.json()).values ?? []
        }
        let people
        try {
          const [vals, forms] = await Promise.all([grab('UNFORMATTED_VALUE'), grab('FORMULA')])
          people = parsePeople(vals, forms)
        } catch (err) {
          report.push({ production: prod.id, error: String((err as Error)?.message ?? err) })
          continue
        }

        // Skip duplicate names on both sides (same safety rule as the modal).
        const counts = new Map<string, number>()
        for (const p of people) counts.set(norm(p.name), (counts.get(norm(p.name)) ?? 0) + 1)
        const byName = new Map()
        for (const p of people) if (counts.get(norm(p.name)) === 1) byName.set(norm(p.name), p)

        let updated = 0
        for (const r of synced) {
          const p = byName.get(norm(r.name))
          if (!p) continue
          // deno-lint-ignore no-explicit-any
          const rec: Record<string, any> = {}
          for (const [k, c] of RES_TEXT_COLS) {
            const v = String(p[k] ?? '').trim()
            if (v && v !== String((r as Record<string, unknown>)[c] ?? '').trim()) rec[c] = v
          }
          for (const [k, c] of RES_DATE_COLS) {
            const v = p[k]
            if (v && v !== ((r as Record<string, unknown>)[c] ?? '')) rec[c] = v
          }
          // deno-lint-ignore no-explicit-any
          const rates: any = (r as any).resource_rates ?? {}
          const rrec: Record<string, unknown> = {}
          if (p.weeklyRate != null) {
            const cur = rates.cost_amount == null || rates.cost_amount === '' ? null : Number(rates.cost_amount)
            if (cur !== p.weeklyRate) rrec.cost_amount = p.weeklyRate
            if ((rates.cost_type ?? '') !== 'weekly' && (cur !== p.weeklyRate || rates.cost_type !== 'weekly')) rrec.cost_type = 'weekly'
          }
          for (const [k, c] of RATE_NUM_COLS) {
            const v = p[k]
            if (v == null) continue
            const cur = rates[c] == null || rates[c] === '' ? null : Number(rates[c])
            if (cur !== v) rrec[c] = v
          }
          if (Object.keys(rec).length) {
            const { error } = await adminC.from('resources').update(rec).eq('id', r.id)
            if (error) { report.push({ resource: r.id, error: error.message }); continue }
          }
          if (Object.keys(rrec).length) {
            const { error } = await adminC.from('resource_rates').upsert(
              { resource_id: r.id, production_id: prod.id, ...rrec },
              { onConflict: 'resource_id' },
            )
            if (error) { report.push({ resource: r.id, error: error.message }); continue }
          }
          if (Object.keys(rec).length || Object.keys(rrec).length) updated++
        }

        // People in the sheet with no matching crew row at all → auto-add as
        // PENDING rows (amber "Allow sync" in the tracker; not locked, not yet
        // sheet-managed until someone allows them).
        const crewNames = new Set((allCrew ?? []).map(r => norm(r.name)))
        let added = 0
        for (const [key, p] of byName) {
          if (crewNames.has(key)) continue
          const id = crypto.randomUUID()
          // deno-lint-ignore no-explicit-any
          const rec: Record<string, any> = {
            id, production_id: prod.id, type: 'crew', crew_class: 'additional',
            sort_order: Date.now() + added,
            name: p.name, role: p.role, department: p.department,
            contact_email: p.email, contact_phone: p.phone, agent: p.agent,
            tax_status: p.taxStatus,
            deal_memo_emailed: p.dealMemoEmailed, deal_memo_drafted: p.dealMemoDrafted,
            deal_memo_sent: p.dealMemoSent, deal_memo_executed: p.dealMemoExecuted,
            payroll_forwarded: p.payrollForwarded, team_engine: p.teamEngine,
            shoot_crew: p.shootCrew, rtw_check: p.rtwCheck,
            hire_start_date: p.startDate || null, hire_end_date: p.endDate || null,
            sheet_synced: false, sheet_pending: true,
          }
          const { error: insErr } = await adminC.from('resources').insert(rec)
          if (insErr) { report.push({ production: prod.id, insert: p.name, error: insErr.message }); continue }
          const rrec: Record<string, unknown> = { resource_id: id, production_id: prod.id }
          if (p.weeklyRate != null) { rrec.cost_amount = p.weeklyRate; rrec.cost_type = 'weekly' }
          for (const [k, c] of RATE_NUM_COLS) if (p[k] != null) rrec[c] = p[k]
          if (Object.keys(rrec).length > 2) await adminC.from('resource_rates').insert(rrec)
          added++
        }

        report.push({ production: prod.id, syncedRows: synced.length, updated, added })
      }
      return json({ ok: true, report })
    }

    // ── Caller auth ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await callerClient.auth.getUser()
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { productionId } = body
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

    // ── Fix-dates write action (owner/admin; used by assisted corrections) ──
    // body.updates = [{ row, col, value }] with 1-based row/col; each value is
    // written with USER_ENTERED so the sheet (now UK locale) parses it as a
    // real date. The service account must have Editor access on the sheet.
    if (body.action === 'fix-dates') {
      const updates = Array.isArray(body.updates) ? body.updates.slice(0, 200) : []
      if (!updates.length) return json({ error: 'No updates given.' }, 400)
      const { data: prodW, error: prodWErr } = await adminClient
        .from('production').select('crew_sheet_url').eq('id', productionId).maybeSingle()
      if (prodWErr) throw prodWErr
      const sheetIdW = extractSheetId(prodW?.crew_sheet_url ?? '')
      if (!sheetIdW) return json({ error: 'No Google Sheet link saved.' }, 400)
      const saW = JSON.parse(Deno.env.get('GOOGLE_SA_KEY') ?? '{}')
      const tokenW = await googleAccessToken(saW.client_email, saW.private_key)
      const colA1 = (n: number) => { let s2 = ''; while (n > 0) { const r2 = (n - 1) % 26; s2 = String.fromCharCode(65 + r2) + s2; n = Math.floor((n - 1) / 26) } return s2 }
      const data = updates
        .filter((u: { row: number; col: number; value: unknown }) =>
          Number.isInteger(u.row) && u.row > 0 && Number.isInteger(u.col) && u.col > 0 && typeof u.value === 'string' && u.value.length < 20)
        .map((u: { row: number; col: number; value: string }) => ({
          range: `${colA1(u.col)}${u.row}`,
          values: [[u.value]],
        }))
      const resW = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetIdW}/values:batchUpdate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenW}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
        },
      )
      if (resW.status === 403) return json({ error: 'The service account needs Editor access on the sheet to write corrections.' }, 403)
      if (!resW.ok) return json({ error: `Sheets write failed (${resW.status}): ${await resW.text()}` }, 500)
      const body2 = await resW.json()
      return json({ ok: true, updatedCells: body2.totalUpdatedCells ?? data.length })
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

    const range = 'A1:ZZ3000'   // first sheet; wide enough for trackers with extra columns
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
