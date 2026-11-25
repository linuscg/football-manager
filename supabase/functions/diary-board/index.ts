// ─── Diary board (TV view) ───────────────────────────────────────────────────
//
// Reads the production's diary sheet and travel/accommodation log sheet
// server-side with the Google service account (same GOOGLE_SA_KEY as
// crew-sheet-sync; each sheet must be shared with the SA email) and returns
// only what the board shows. Costs, booking refs and payment columns never
// leave the server.
//
// Caller: any member of the production (or the app owner).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const b64url = (buf: ArrayBuffer | string) => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function googleAccessToken(saEmail: string, privateKeyPem: string): Promise<string> {
  const pem = privateKeyPem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: saEmail, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${payload}.${b64url(sig)}` }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`)
  return (await res.json()).access_token
}

function extractSheetId(input: string): string | null {
  const s = String(input ?? '').trim()
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/)
  if (m) return m[1]
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null
}

class SheetError extends Error {}

async function sheetTitles(id: string, token: string, label: string, saEmail: string): Promise<string[]> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 403) throw new SheetError(`No access to the ${label} sheet — share it with ${saEmail} (Viewer is enough).`)
  if (res.status === 404) throw new SheetError(`The ${label} sheet wasn't found — check the saved link.`)
  if (!res.ok) throw new SheetError(`Google Sheets error ${res.status} reading the ${label} sheet.`)
  // deno-lint-ignore no-explicit-any
  return ((await res.json()).sheets ?? []).map((s: any) => s.properties?.title as string)
}

async function values(id: string, token: string, range: string): Promise<string[][]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new SheetError(`Google Sheets error ${res.status} reading ${range}.`)
  return (await res.json()).values ?? []
}

const q = (t: string) => `'${t.replace(/'/g, "''")}'`
const pick = (titles: string[], ...res: RegExp[]) => {
  for (const re of res) { const t = titles.find(x => re.test(x)); if (t) return t }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authError } = await callerClient.auth.getUser()
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { productionId } = await req.json()
    if (!productionId) return json({ error: 'Missing productionId' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const [{ data: membership }, { data: profile }, { data: prod, error: prodErr }] = await Promise.all([
      admin.from('production_members').select('role').eq('production_id', productionId).eq('user_id', user.id).maybeSingle(),
      admin.from('profiles').select('is_owner').eq('id', user.id).maybeSingle(),
      admin.from('production').select('diary_sheet_url, travel_sheet_url').eq('id', productionId).maybeSingle(),
    ])
    if (prodErr) throw prodErr
    if (!membership && profile?.is_owner !== true) return json({ error: 'Not a member of this production.' }, 403)

    const diaryId = extractSheetId(prod?.diary_sheet_url ?? '')
    const travelId = extractSheetId(prod?.travel_sheet_url ?? '')
    if (!diaryId && !travelId) return json({ ok: true, configured: false })

    const sa = JSON.parse(Deno.env.get('GOOGLE_SA_KEY') ?? '{}')
    if (!sa.client_email || !sa.private_key) return json({ error: 'GOOGLE_SA_KEY secret is not configured.' }, 500)
    const token = await googleAccessToken(sa.client_email, sa.private_key)

    const out: Record<string, unknown> = { ok: true, configured: true, serviceAccount: sa.client_email, errors: [] }
    const errors = out.errors as string[]

    // ── Diary: the week-grid tab (header rows of "Mon 23 Nov" … day columns)
    if (diaryId) {
      try {
        const titles = await sheetTitles(diaryId, token, 'diary', sa.client_email)
        const tab = pick(titles, /internal diary/i, /diary/i) ?? titles[0]
        // Values + text colours: the diary colour-codes entries (green = recce,
        // red = fitting …) against a key; runs come back per cell as
        // [[startIndex, '#rrggbb'], …] with the cell's default colour first.
        const range = `${q(tab)}!A1:J600`
        const fields = 'sheets.data.rowData.values(formattedValue,textFormatRuns(startIndex,format/foregroundColorStyle),effectiveFormat/textFormat/foregroundColorStyle)'
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${diaryId}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent(fields)}`,
          { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new SheetError(`Google Sheets error ${res.status} reading the diary.`)
        // deno-lint-ignore no-explicit-any
        const rowData: any[] = (await res.json()).sheets?.[0]?.data?.[0]?.rowData ?? []
        // deno-lint-ignore no-explicit-any
        const hex = (st: any) => {
          const c = st?.rgbColor
          if (!c) return null
          const h = (v: number | undefined) => Math.round((v ?? 0) * 255).toString(16).padStart(2, '0')
          return `#${h(c.red)}${h(c.green)}${h(c.blue)}`
        }
        const grid: string[][] = []
        const colours: (Array<[number, string | null]> | null)[][] = []
        rowData.forEach((row, r) => {
          grid[r] = []; colours[r] = []
          // deno-lint-ignore no-explicit-any
          ;(row?.values ?? []).forEach((v: any, c: number) => {
            grid[r][c] = v?.formattedValue ?? ''
            const base = hex(v?.effectiveFormat?.textFormat?.foregroundColorStyle)
            // deno-lint-ignore no-explicit-any
            const runs = (v?.textFormatRuns ?? []).map((t: any) => [t.startIndex ?? 0, hex(t.format?.foregroundColorStyle)] as [number, string | null])
            colours[r][c] = grid[r][c] ? [[-1, base], ...runs] : null
          })
        })
        out.diary = grid
        out.diaryColours = colours
        out.diaryTab = tab
      } catch (e) { errors.push(String((e as Error).message)) }
    }

    // ── Travel log + accommodation log (only the columns the board shows)
    if (travelId) {
      try {
        const titles = await sheetTitles(travelId, token, 'travel', sa.client_email)
        const travelTab = pick(titles, /travel log/i)
        const accomTab = pick(titles, /accom.*log/i, /accom/i)
        if (travelTab) {
          const rows = await values(travelId, token, `${q(travelTab)}!A4:AM500`)
          // Outbound D–V (3–21), return W–AM (22–38). Booking refs (5, 24),
          // seats (6, 25) and transfer notes are dropped.
          const leg = (r: string[], o: number) => ({
            number: r[o] ?? '', carrier: r[o + 1] ?? '', cls: r[o + 4] ?? '', date: r[o + 5] ?? '',
            fromCode: r[o + 7] ?? '', fromCity: r[o + 8] ?? '', fromTerminal: r[o + 9] ?? '', depart: r[o + 10] ?? '',
            toCode: r[o + 12] ?? '', toCity: r[o + 13] ?? '', toTerminal: r[o + 14] ?? '', arrive: r[o + 15] ?? '',
            arriveDate: r[o + 16] ?? '',
          })
          out.travel = rows
            .filter(r => String(r[1] ?? '').trim())
            .map(r => ({ name: String(r[1]).trim(), role: r[2] ?? '', out: leg(r, 3), ret: leg(r, 22) }))
        }
        if (accomTab) {
          const rows = await values(travelId, token, `${q(accomTab)}!A1:H800`)
          out.accom = rows
            .filter(r => String(r[2] ?? '').trim() && (r[6] || r[7]))
            .map(r => ({ name: String(r[2]).trim(), role: r[1] ?? '', place: r[3] ?? '', checkIn: r[6] ?? '', checkOut: r[7] ?? '' }))
        }
      } catch (e) { errors.push(String((e as Error).message)) }
    }

    out.fetchedAt = new Date().toISOString()
    return json(out)
  } catch (err) {
    console.error('[diary-board]', err)
    return json({ error: String((err as Error)?.message ?? err) }, 500)
  }
})
