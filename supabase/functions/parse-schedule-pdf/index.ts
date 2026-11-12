import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk/helpers/zod'
import { z } from 'npm:zod@3'

// Default extractor: Gemini (free tier). History of this choice:
//  - 2.5-flash is primary, flash-lite is the availability fallback (the free
//    flash pool hit "high demand" overloads often enough to need one).
//  - UNBOUNDED thinking on flash once crashed the Supabase worker
//    (WORKER_RESOURCE_LIMIT), so thinking was fully disabled — which caused
//    dropped scene numbers / misassigned scenes. The compromise now is a
//    BOUNDED thinking budget: enough reasoning for accuracy, capped so the
//    call can't run long enough to kill the worker.
// If ANTHROPIC_API_KEY is ever set as an edge-function secret, Claude Opus 5.5
// (native PDF input + strict structured outputs) is used instead — paid.
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const CLAUDE_MODEL = 'claude-opus-5-5'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
const GEMINI_THINKING_BUDGET = 8192

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Output schema (shared shape; Zod for Claude, JSON schema for Gemini) ─────
const SceneSchema = z.object({
  sceneNumber:   z.string().describe('Scene number exactly as printed, e.g. "13", "92 pt 1 of 2". Empty string ONLY if the strip truly prints no scene number.'),
  intExt:        z.enum(['INT', 'EXT']).describe('INT or EXT. Default INT if unclear.'),
  setName:       z.string().describe('The set/location name in bold, e.g. "THEATRE - STAGE".'),
  description:   z.string().describe('The scene description line.'),
  dayNight:      z.enum(['MORNING', 'DAY', 'DUSK', 'EVENING', 'NIGHT']).describe('Time of day. Map the printed word; default DAY.'),
  storyDay:      z.string().describe('The story-day number printed under the time of day, e.g. "3". Empty if none.'),
  pages:         z.string().describe('Page count as printed, e.g. "4/8", "1 1/8". Empty if none.'),
  castNumbers:   z.array(z.string()).describe('Cast numbers listed after "C:", e.g. ["1","8","10"].'),
  saCount:       z.string().describe('Supporting artists count after "SA\'s:", e.g. "0", "100". Empty if none.'),
  danceSequence: z.string().describe('The dance-sequence label printed under the scene number / INT-EXT (e.g. KNOCK, ANI, DANCE, BALLET). Empty if none.'),
})

const DaySchema = z.object({
  type:      z.enum(['main', 'prep', 'rest', 'splinter', 'unscheduled']).describe('main = numbered shoot day; prep/pre-shoot = prep; rest = rest day; splinter = splinter unit; unscheduled = scenes not yet assigned to a day.'),
  dayNumber: z.number().int().nullable().describe('Shoot day number from the "End of Day # N" banner for main days, else null.'),
  date:      z.string().describe('ISO date YYYY-MM-DD if known, else empty string.'),
  location:  z.string().describe('Location/venue header that applies to this day, e.g. "TRING PARK SCHOOL". Empty if unknown.'),
  notes:     z.string().describe('Any day-level banner text or notes. Empty if none.'),
  scenes:    z.array(SceneSchema),
})

const ScheduleSchema = z.object({
  cast: z.array(z.object({
    number:    z.string().describe('Cast number/code as printed, e.g. "1", "IC".'),
    character: z.string().describe('Character name and any parenthetical note.'),
  })).describe('The cast member legend, mapping cast numbers to character names.'),
  days: z.array(DaySchema).describe('Every shooting day, prep/pre-shoot day, and rest day, in document order.'),
})

const PROMPT = `You are parsing a film/TV "one-line" shooting schedule PDF into structured JSON. Work slowly and exactly. Accuracy of which scene belongs to which day matters most, and every scene's printed scene number must be captured exactly.

WHAT THE DOCUMENT LOOKS LIKE:
- It is a bordered TABLE. Each row is a full-width horizontal "strip".
- There are three kinds of strip:
  (A) SCENE strip — has the column layout below.
  (B) END-OF-DAY banner — a full-width row reading like "End of Day # 1 -- Monday, 20 July 2026 -- Total Pgs: 5 3/8" or "End of Shooting Day 1 -- Monday, 14 December 2026 -- 4 Pages". This is the ONLY thing that ends a day.
  (C) TEXT strip — anything else (headers, instructions, totals, location names). Never a scene, never a day delimiter.

A SCENE strip comes in two common layouts — check which one THIS document uses before parsing:

LAYOUT 1 — unlabelled columns, left → right:
  1) Scene number (bold, far left). May be blank.
  2) INT or EXT.
  3) Bold SET name, with a description line under it. (May have a small dance-sequence tag like KNOCK/ANI/DANCE under the scene number — put it in danceSequence.)
  4) Time-of-day WORD (Morning/Day/Dusk/Evening/Night) with a NUMBER directly beneath it. THAT NUMBER IS THE STORY DAY → put it in "storyDay".
  5) Page count, e.g. "4/8" then "Pgs".
  6) CAST column, prefixed "C:" e.g. "C: 1, 3, 4" → put each number in "castNumbers" (["1","3","4"]).
  7) "SA's:" count (supporting artists/extras) → put in "saCount".

LAYOUT 2 — LABELLED cells. Each strip's cells carry their own label, e.g.:
  "Day: 2" over "5 1/8 pgs" | "Scenes: 49" | INT over Night | SET NAME + right-aligned venue, description line under | "1, 8, 12" | "SA's: 0" | Shots: | Time:
  Read by LABEL, not by position:
  - "Scenes:" value → sceneNumber (here "49"). THIS is the scene number even though it is NOT the far-left cell.
  - "Day:" value inside a strip → storyDay (here "2"). It is NEVER the scene number and NEVER the shoot day.
  - "N/8 pgs" → pages. INT/EXT cell with the time-of-day word under it → intExt + dayNight.
  - The bare comma-separated number list ("1, 8, 12", possibly with suffixes like "1st", "20bd") → castNumbers, each entry copied as printed.
  - A right-aligned venue in the set-name cell (e.g. "Studio stage 6") belongs to the day's location, not the description.

SCENE NUMBERS — NEVER DROP THEM:
- EVERY scene strip has a printed scene number: in Layout 1 it is the bold far-LEFT cell; in Layout 2 it is the value of the cell labelled "Scenes:". Read it for EVERY scene strip and copy it character-for-character, including suffixes like "pt 1 of 2", "A", "B", "cont", "pt".
- Leave "sceneNumber" empty ONLY when that cell is genuinely blank in the PDF. A hard-to-read or small number is still a number — read it, don't skip it.
- NEVER put a "Day:"-labelled value, a page count, or a cast number into sceneNumber.
- Do not renumber, merge, or invent scenes. Each printed scene strip = exactly one scene object in the output.

⚠ CRITICAL — TWO DIFFERENT "DAY" NUMBERS, DO NOT CONFUSE THEM:
- The STORY DAY (fiction's internal day) is: in Layout 1 the number under the time-of-day word; in Layout 2 the "Day:"-labelled value inside the strip. Put it in "storyDay". It has NOTHING to do with which shoot day the scene is on. A scene with "Evening / 20" is NOT shoot day 20.
- The SHOOT DAY number comes ONLY from the day banners: an "End of Day # N" / "End of Shooting Day N" banner, or a day heading like "DAY N  call 08:00 - wrap 18:30  MON 14 DEC". That N is the dayNumber.
- Never use a scene's story-day number, page count, or cast number as a shoot-day number.

HOW TO ASSIGN SCENES TO DAYS — a strict top-to-bottom state machine:
1. Start an empty "current day" (scenes: [], notes: "").
2. Read strips ONE AT A TIME, in exact printed order (page 1 top→bottom, then page 2, …). Never look ahead, never reorder.
3. SCENE strip → append to the CURRENT day's scenes (the one open right now).
4. TEXT strip → append its text to the CURRENT day's notes (one line each).
5. END-OF-DAY banner "End of Day # N -- <date> ..." → close the current day: set its dayNumber = N and date = that banner's date as YYYY-MM-DD. Then open a fresh empty current day.
6. At the very end, output the still-open day even if no banner follows it.
The scenes of one day are a single CONTIGUOUS block ending at that day's banner — scenes from different days are never mixed. The number of "main" days you output MUST equal the number of "End of Day" banners.

WORKED EXAMPLE (input strips top-to-bottom → output):
Strips:
  "TRING PARK SCHOOL - Shoot 22 days"        (text)
  "ALL SCENES TO RUN TOGETHER"               (text)
  53 | INT | EMI'S HOME - LIVING ROOM / Emi finds her parents dancing. | Day 11 | 2 Pgs | C: 1, 3, 4 | SA's: 0   (scene)
  35 | INT | TRAIN - LAVATORY / Emi hides.   | Day 8  | 5/8 Pgs | C: 1 | SA's: 0   (scene)
  "Day 1 Total Pages 2 5/8"                  (text)
  "End of Day # 1 -- Monday, 20 July 2026 -- Total Pgs: 2 5/8"   (banner)
  81 | INT | THEATRE - AUDITORIUM / Leo rehearses. | Morning 14 | 7/8 Pgs | C: 1, 2 | SA's: 12   (scene)
  "End of Day # 2 -- Tuesday, 21 July 2026"  (banner)
Output:
{"cast":[...],"days":[
  {"type":"main","dayNumber":1,"date":"2026-07-20","location":"TRING PARK SCHOOL","notes":"ALL SCENES TO RUN TOGETHER\\nDay 1 Total Pages 2 5/8","scenes":[
     {"sceneNumber":"53","intExt":"INT","setName":"EMI'S HOME - LIVING ROOM","description":"Emi finds her parents dancing.","dayNight":"DAY","storyDay":"11","pages":"2","castNumbers":["1","3","4"],"saCount":"0","danceSequence":""},
     {"sceneNumber":"35","intExt":"INT","setName":"TRAIN - LAVATORY","description":"Emi hides.","dayNight":"DAY","storyDay":"8","pages":"5/8","castNumbers":["1"],"saCount":"0","danceSequence":""}
  ]},
  {"type":"main","dayNumber":2,"date":"2026-07-21","location":"TRING PARK SCHOOL","notes":"","scenes":[
     {"sceneNumber":"81","intExt":"INT","setName":"THEATRE - AUDITORIUM","description":"Leo rehearses.","dayNight":"MORNING","storyDay":"14","pages":"7/8","castNumbers":["1","2"],"saCount":"12","danceSequence":""}
  ]}
]}
Note how the story-day numbers (11, 8, 14) went to storyDay, the shoot-day numbers (1, 2) came only from the banners, and text strips became notes.

CAST LEGEND:
- Page 1 is usually a CAST MEMBERS legend (numbered list: number → character name). Extract every entry into "cast".

OTHER RULES:
- An "End of Day" banner is NEVER a scene and NEVER a note — never put its text in notes, never skip one.
- A page break / repeated column header / page footer does NOT end a day. Only "End of Day" banners do. Keep going across page breaks.
- UNSCHEDULED: at an "Unscheduled"/"Scenes Not Scheduled" header, close the current day and open ONE day with type "unscheduled" (no dayNumber, no date). ALL scenes after that header go there even with no End-of-Day banner. Do not drop them.
- Location headers (e.g. "TRING PARK SCHOOL - Shoot 22 days") apply to following days until the next location header → put the venue in each day's "location".
- Ignore "WEEK 1/2" banners and sunrise/sunset lines.
- "PRE-SHOOT DURING PREP WEEKS" → type "prep". Splinter unit → "splinter". Normal numbered days → "main".
- "REST DAY" → type "rest" (no scenes), but ONLY if it is a WEEKDAY (Mon–Fri). Skip Saturday/Sunday rest days entirely.
- Missing value → empty string (or empty array for castNumbers). Never invent data.
- Before finishing, re-check: every scene strip in the PDF appears exactly once, with its printed scene number, under the correct day.`

// ── Claude extraction (opt-in, paid — only runs if ANTHROPIC_API_KEY is set) ──
async function parseWithClaude(pdfBase64: string) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  // Stream to avoid HTTP timeouts on a long structured output, then collect
  // the final message. Server-side refusal fallback is enabled so a safety
  // false-positive re-runs on a fallback model inside the same call.
  const stream = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'high',
      format: zodOutputFormat(ScheduleSchema),
    },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  })

  const message = await stream.finalMessage()

  if (message.stop_reason === 'refusal') {
    throw new Error('The model declined to process this document. Please try again or contact support.')
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The schedule is too large to parse in one pass — try splitting the PDF and importing in parts.')
  }

  const text = message.content
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text?: string }) => b.text ?? '')
    .join('')
  if (!text) throw new Error('The model returned no content.')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Could not parse the model JSON output.')
  }

  // Validate against the schema; structured outputs should guarantee this,
  // but a truncated stream could slip through — fail loudly rather than
  // import a half-read schedule.
  const check = ScheduleSchema.safeParse(parsed)
  if (!check.success) {
    throw new Error('Model output did not match the expected schedule shape.')
  }

  return { result: check.data, model: message.model }
}

// ── Gemini extraction (default, free tier; used when no ANTHROPIC_API_KEY) ───
const geminiResponseSchema = {
  type: 'object',
  properties: {
    cast: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number:    { type: 'string' },
          character: { type: 'string' },
        },
        required: ['number', 'character'],
      },
    },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type:      { type: 'string', enum: ['main', 'prep', 'rest', 'splinter', 'unscheduled'] },
          dayNumber: { type: 'integer', nullable: true },
          date:      { type: 'string' },
          location:  { type: 'string' },
          notes:     { type: 'string' },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sceneNumber:   { type: 'string' },
                intExt:        { type: 'string', enum: ['INT', 'EXT'] },
                setName:       { type: 'string' },
                description:   { type: 'string' },
                dayNight:      { type: 'string', enum: ['MORNING', 'DAY', 'DUSK', 'EVENING', 'NIGHT'] },
                storyDay:      { type: 'string' },
                pages:         { type: 'string' },
                castNumbers:   { type: 'array', items: { type: 'string' } },
                saCount:       { type: 'string' },
                danceSequence: { type: 'string' },
              },
              required: ['sceneNumber', 'intExt', 'setName', 'description', 'dayNight'],
            },
          },
        },
        required: ['type', 'scenes'],
      },
    },
  },
  required: ['cast', 'days'],
}

async function parseWithGemini(pdfBase64: string) {
  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
        { text: PROMPT },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: geminiResponseSchema,
      temperature: 0,
      maxOutputTokens: 65536,
      // Bounded thinking: 0 caused the accuracy bugs (dropped scene numbers),
      // unlimited caused WORKER_RESOURCE_LIMIT crashes. A fixed budget gives
      // the reasoning the task needs with a hard cap on time/compute. If
      // WORKER_RESOURCE_LIMIT ever reappears, lower this before disabling it.
      thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
    },
  }
  const bodyStr = JSON.stringify(body)

  let res: Response | undefined
  let data: { error?: { message?: string; details?: Array<{ '@type'?: string; retryDelay?: string }> }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | undefined
  let usedModel = ''
  const MAX_ATTEMPTS = 3

  for (let m = 0; m < GEMINI_MODELS.length; m++) {
    const model = GEMINI_MODELS[m]
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`
    let modelUnavailable = false

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      })
      data = await res.json()

      if (res.ok) { usedModel = model; break }

      const retryable = res.status === 429 || res.status === 503
      if (retryable && attempt < MAX_ATTEMPTS) {
        let waitMs = 0
        const details = data?.error?.details ?? []
        const retryInfo = details.find(d => d['@type']?.includes('RetryInfo'))
        if (retryInfo?.retryDelay) {
          waitMs = (parseFloat(String(retryInfo.retryDelay).replace('s', '')) || 0) * 1000
        }
        if (!waitMs) waitMs = 1200 * Math.pow(2, attempt - 1)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
      if (retryable) { modelUnavailable = true }
      break
    }

    if (res!.ok) break
    if (!modelUnavailable) break
  }

  if (!res!.ok) {
    const msg = data?.error?.message ?? 'Gemini request failed.'
    const friendly = (res!.status === 429 || res!.status === 503)
      ? `All schedule-parsing models are busy right now. ${msg} — please wait a minute and try again.`
      : msg
    throw new Error(friendly)
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned no content.')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Could not parse Gemini JSON output.')
  }

  return { result: parsed, model: usedModel }
}

// ── HTTP handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!ANTHROPIC_API_KEY && !GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'No AI provider key is configured (ANTHROPIC_API_KEY or GEMINI_API_KEY).' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Require a signed-in user — without this the function is an open proxy
    // for the provider API key (the anon key alone passes the gateway).
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { pdfBase64 } = await req.json()
    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: 'Missing pdfBase64 in request body.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { result, model } = ANTHROPIC_API_KEY
      ? await parseWithClaude(pdfBase64)
      : await parseWithGemini(pdfBase64)

    return new Response(JSON.stringify({ ok: true, result, model }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('parse-schedule-pdf failed:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
