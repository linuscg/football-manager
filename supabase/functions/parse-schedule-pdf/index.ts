import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
// Try the more capable model first; fall back to the lighter, higher-availability
// model if the primary is overloaded / rate-limited.
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Structured output schema Gemini must return
const responseSchema = {
  type: 'object',
  properties: {
    cast: {
      type: 'array',
      description: 'The cast member legend, mapping cast numbers to character names.',
      items: {
        type: 'object',
        properties: {
          number:    { type: 'string', description: 'Cast number/code as printed, e.g. "1", "IC".' },
          character: { type: 'string', description: 'Character name and any parenthetical note.' },
        },
        required: ['number', 'character'],
      },
    },
    days: {
      type: 'array',
      description: 'Every shooting day, prep/pre-shoot day, and rest day, in document order.',
      items: {
        type: 'object',
        properties: {
          type:      { type: 'string', enum: ['main', 'prep', 'rest', 'splinter', 'unscheduled'], description: 'main = numbered shoot day; prep/pre-shoot = prep; rest = rest day; splinter = splinter unit; unscheduled = scenes listed as unscheduled / not yet assigned to a day (usually at the end of the document).' },
          dayNumber: { type: 'integer', description: 'Shoot day number for main days, else null/0.', nullable: true },
          date:      { type: 'string', description: 'ISO date YYYY-MM-DD if known, else empty string.' },
          location:  { type: 'string', description: 'Location/venue header that applies to this day, e.g. "TRING PARK SCHOOL". Empty if unknown.' },
          notes:     { type: 'string', description: 'Any day-level banner text or notes (e.g. "ALLOW TIME FOR VFX", free-text notes). Empty if none.' },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sceneNumber:   { type: 'string', description: 'Scene number exactly as printed, e.g. "13", "92 pt 1 of 2".' },
                intExt:        { type: 'string', enum: ['INT', 'EXT'], description: 'INT or EXT. Default INT if unclear.' },
                setName:       { type: 'string', description: 'The set/location name in bold, e.g. "THEATRE - STAGE".' },
                description:   { type: 'string', description: 'The scene description line.' },
                dayNight:      { type: 'string', enum: ['MORNING', 'DAY', 'DUSK', 'EVENING', 'NIGHT'], description: 'Time of day. Map the printed word; default DAY.' },
                storyDay:      { type: 'string', description: 'The story-day number printed under the time of day, e.g. "3". Empty if none.' },
                pages:         { type: 'string', description: 'Page count as printed, e.g. "4/8", "1 1/8". Empty if none.' },
                castNumbers:   { type: 'array', items: { type: 'string' }, description: 'Cast numbers listed after "C:", e.g. ["1","8","10"].' },
                saCount:       { type: 'string', description: 'Supporting artists count after "SA\'s:", e.g. "0", "100". Empty if none.' },
                danceSequence: { type: 'string', description: 'The dance-sequence label printed under the scene number / INT-EXT (e.g. KNOCK, ANI, DANCE, BALLET). Empty if none.' },
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

const PROMPT = `You are parsing a film/TV "one-line" shooting schedule PDF into structured JSON. Work slowly and exactly. Accuracy of which scene belongs to which day matters most.

WHAT THE DOCUMENT LOOKS LIKE:
- It is a bordered TABLE. Each row is a full-width horizontal "strip".
- There are three kinds of strip:
  (A) SCENE strip — has the column layout below.
  (B) END-OF-DAY banner — a full-width row reading like "End of Day # 1 -- Monday, 20 July 2026 -- Total Pgs: 5 3/8". This is the ONLY thing that ends a day.
  (C) TEXT strip — anything else (headers, instructions, totals, location names). Never a scene, never a day delimiter.

A SCENE strip has these columns, left → right:
  1) Scene number (bold, far left). May be blank.
  2) INT or EXT.
  3) Bold SET name, with a description line under it. (May have a small dance-sequence tag like KNOCK/ANI/DANCE under the scene number — put it in danceSequence.)
  4) Time-of-day WORD (Morning/Day/Dusk/Evening/Night) with a NUMBER directly beneath it. THAT NUMBER IS THE STORY DAY → put it in "storyDay".
  5) Page count, e.g. "4/8" then "Pgs".
  6) CAST column, prefixed "C:" e.g. "C: 1, 3, 4" → put each number in "castNumbers" (["1","3","4"]).
  7) "SA's:" count (supporting artists/extras) → put in "saCount".

⚠ CRITICAL — TWO DIFFERENT "DAY" NUMBERS, DO NOT CONFUSE THEM:
- The number under the time-of-day word (column 4) is the STORY DAY. It is fiction's internal day. Put it in "storyDay". It has NOTHING to do with which shoot day the scene is on. A scene with "Evening / 20" is NOT shoot day 20.
- The SHOOT DAY number comes ONLY from the "End of Day # N" banner. That N is the dayNumber for the day that just ended.
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
- Scene number exactly as printed; if none, leave "sceneNumber" empty — never invent one.
- Location headers (e.g. "TRING PARK SCHOOL - Shoot 22 days") apply to following days until the next location header → put the venue in each day's "location".
- Ignore "WEEK 1/2" banners and sunrise/sunset lines.
- "PRE-SHOOT DURING PREP WEEKS" → type "prep". Splinter unit → "splinter". Normal numbered days → "main".
- "REST DAY" → type "rest" (no scenes), but ONLY if it is a WEEKDAY (Mon–Fri). Skip Saturday/Sunday rest days entirely.
- Missing value → empty string (or empty array for castNumbers). Never invent data.
- Return ONLY the structured JSON matching the schema.`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not set as an Edge Function secret.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { pdfBase64 } = await req.json()
    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: 'Missing pdfBase64 in request body.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
          { text: PROMPT },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0,
        maxOutputTokens: 65536,
        // Disable "thinking" — 2.5 models think by default, which burns far more
        // time/compute (and can blow the edge-function resource limit). For
        // structured extraction we don't need it.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }
    const bodyStr = JSON.stringify(body)   // stringify once, reuse across attempts

    // Try each model in order. Within a model, retry/backoff on 429 (rate limit)
    // and 503 (overload). If a model stays unavailable after its retries, fall
    // back to the next model. A non-retryable error (e.g. 400) returns immediately.
    let res
    let data
    let usedModel = ''
    const MAX_ATTEMPTS = 3

    for (let m = 0; m < MODELS.length; m++) {
      const model = MODELS[m]
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
          // Respect Gemini's RetryInfo if present, else exponential backoff.
          let waitMs = 0
          const details = data?.error?.details ?? []
          const retryInfo = details.find((d: { '@type'?: string; retryDelay?: string }) =>
            d['@type']?.includes('RetryInfo'))
          if (retryInfo?.retryDelay) {
            waitMs = (parseFloat(String(retryInfo.retryDelay).replace('s', '')) || 0) * 1000
          }
          if (!waitMs) waitMs = 1200 * Math.pow(2, attempt - 1) // 1.2s, 2.4s
          await new Promise(r => setTimeout(r, waitMs))
          continue
        }
        // Retries exhausted (still 429/503) → try the next model.
        if (retryable) { modelUnavailable = true }
        break
      }

      if (res!.ok) break              // success
      if (!modelUnavailable) break    // non-retryable error — don't fall back
      // else: loop to the next (fallback) model
    }

    if (!res!.ok) {
      const msg = data?.error?.message ?? 'Gemini request failed.'
      const friendly = (res!.status === 429 || res!.status === 503)
        ? `All schedule-parsing models are busy right now. ${msg} — please wait a minute and try again.`
        : msg
      return new Response(JSON.stringify({ error: friendly, status: res!.status, detail: data }), {
        status: res!.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      return new Response(JSON.stringify({ error: 'Gemini returned no content.', detail: data }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return new Response(JSON.stringify({ error: 'Could not parse Gemini JSON output.', raw: text }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, result: parsed, model: usedModel }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
