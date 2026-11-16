// ─── Background Day-out-of-Days (DooD) PDF parser ─────────────────────────────
// Gemini free tier, same model policy as parse-schedule-pdf (see CLAUDE.md):
// gemini-2.5-flash primary, flash-lite availability fallback, BOUNDED thinking.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
const GEMINI_THINKING_BUDGET = 8192

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const PROMPT = `You are parsing a film "Day Out of Days Report for Background Actors" PDF into JSON. Work slowly and exactly.

LAYOUT:
- Each ROW is one background/supporting-artist group. Its first cell reads like "104.  Subway commuters (30)": the ID number ("104"), the description ("Subway commuters"), and the headcount in brackets ("30"). A row with NO brackets has headcount 1.
- The other columns are a date grid. Header rows give Day/Month (e.g. "14/12"), Day of Week, and Shooting Day number. Dates run LEFT TO RIGHT and CONTINUE ACROSS PAGES: later pages repeat the same rows with further date columns, then summary columns (Work / Hold / Holiday / Start / Finish / TOTAL) — ignore the summary columns.
- MERGE each row's cells across all pages by its ID number. The PDF may also contain a second block of additional rows on later pages — include them all.
- Cell codes: "SWF" (start-work-finish), "SW" (start-work), "WF" (work-finish), "W" (work), "S", "F" — ALL of these mean the group WORKS that date. A "/" cell or an empty cell is NOT a work day (the "/" columns are production holidays). "H" (hold) is not a work day.
- Dates are UK dd/mm. The year: the report header shows the report date (e.g. 12-Nov-2026); the schedule runs forward from roughly that date, so December dates are that year and January/February dates are the following year. Output ISO YYYY-MM-DD.

OUTPUT strict JSON only:
{"groups":[{"doodId":"104","description":"Subway commuters","total":30,"workDates":["2026-12-21","2027-01-13"]}]}
Every row in the PDF appears exactly once with ALL of its work dates. Do not invent or drop rows.`

const SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          doodId:      { type: 'string' },
          description: { type: 'string' },
          total:       { type: 'integer' },
          workDates:   { type: 'array', items: { type: 'string' } },
        },
        required: ['doodId', 'description', 'total', 'workDates'],
      },
    },
  },
  required: ['groups'],
}

async function parseWithGemini(pdfBase64: string) {
  let lastErr: unknown = null
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: PROMPT },
                  { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
                ],
              }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: SCHEMA,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
              },
            }),
          },
        )
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error(`${model}: ${res.status}`)
          await new Promise(r => setTimeout(r, 2500 * (attempt + 1)))
          continue
        }
        if (!res.ok) throw new Error(`${model} ${res.status}: ${await res.text()}`)
        const data = await res.json()
        const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
        if (!text) throw new Error('Empty model response')
        return JSON.parse(text)
      } catch (err) {
        lastErr = err
      }
    }
  }
  throw lastErr ?? new Error('All models failed')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { pdfBase64 } = await req.json()
    if (!pdfBase64) return json({ error: 'Missing pdfBase64' }, 400)
    const result = await parseWithGemini(pdfBase64)
    return json({ ok: true, result })
  } catch (err) {
    console.error('[parse-dood-pdf]', err)
    return json({ error: String((err as Error)?.message ?? err) }, 500)
  }
})
