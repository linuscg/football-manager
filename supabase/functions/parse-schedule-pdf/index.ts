import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const MODEL = 'gemini-2.5-flash-lite'

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

const PROMPT = `You are parsing a film/TV "one-line" shooting schedule PDF into structured JSON.

CAST LEGEND:
- The first page is usually a CAST MEMBERS legend: a numbered list mapping a cast number to a character name. Extract every entry into "cast".

BE METHODICAL — this is the most important thing:
- Process the document in strict physical reading order: page 1 top-to-bottom, then page 2 top-to-bottom, and so on. Never jump around or reorder.
- Process ONE strip at a time, exactly in the order they are printed. Do not skip strips and do not look ahead.
- A scene ALWAYS belongs to the day whose "End of Day" banner is the very next "End of Day" banner physically below that scene. Equivalently: a scene belongs to the day that is currently open when you reach it. Never move a scene to a different day than the one it physically sits in.
- Preserve the exact printed order of scenes within each day. Do not sort or rearrange them.
- A strip is a SCENE only if it has the scene-row shape (an INT/EXT marker AND a bold SET name, usually with a time-of-day and a "Pgs" count). If a strip lacks INT/EXT and a set name, it is NOT a scene — it is either an "End of Day" banner (a delimiter) or free text (a note). When unsure, do not guess it into the wrong day.

COLUMNS IN EACH SCENE ROW (left → right): scene number | INT/EXT | set name + description | time-of-day + story day | pages ("Pgs") | CAST | SA's. The SECOND-TO-LAST column is the CAST column, prefixed "C:" — e.g. "C: 1, 3, 4". Read EVERY number in it into "castNumbers" as an array of strings (["1","3","4"]). Almost every scene has a cast list — do not leave castNumbers empty unless the C: column is genuinely blank. The LAST column "SA's:" is a DIFFERENT thing (supporting artists / extras count) — put that number in "saCount", never in castNumbers. Do not confuse the two columns.

HOW TO BUILD THE DAYS — follow this state machine EXACTLY:
1. Keep a "current day" with an empty scene list and empty notes. Start one at the top of the schedule body.
2. When you read a SCENE strip, append it to the CURRENT day's scenes (the day that is open right now — never a previous or later day). A scene strip has: a scene number (bold, left), an optional dance-sequence label beneath it (e.g. KNOCK, ANI, DANCE, BALLET — capture as danceSequence), INT/EXT, a bold SET name, a description line, a time-of-day word (Morning/Day/Dusk/Evening/Night) with a story-day number beneath it, a page count ("Pgs"), a cast list after "C:", and an "SA's:" count.
3. When you read an "End of Day #N -- <date> -- Total Pgs ..." banner: this CLOSES the current day. Set that day's dayNumber = N and date = the banner's date (ISO YYYY-MM-DD). Then START A NEW empty current day for whatever follows.
4. Repeat to the end of the document. Every "End of Day" banner therefore produces exactly one day in the output, in order.
5. AT THE END OF THE DOCUMENT: output the current still-open day even if there is NO closing "End of Day" banner after it. A day is never dropped just because the document ends (or an unscheduled section begins) without an "End of Day" banner.
6. CONTIGUITY: The scenes belonging to one day are printed CONTIGUOUSLY on the page — one unbroken block running down to that day's "End of Day" banner. Scenes from two different days are NEVER interleaved. So when you hit an "End of Day" banner, every scene strip since the previous banner — in the exact printed order — belongs to THIS day. Do not pull a scene up into an earlier day or push it down into a later one.
7. SELF-CHECK before returning: for each day, every scene you listed must physically sit in that day's contiguous block (between its opening point and its "End of Day" banner). If a scene ended up under the wrong day, fix it. The scene numbers within a day must match exactly the scenes printed in that day's block on the page — no more, no fewer.

ABSOLUTELY CRITICAL RULES FOR DAY BANNERS:
- An "End of Day #N" banner is a DELIMITER. It is NEVER a scene and NEVER a note. Never put "End of Day" text into a day's notes. Never skip one. The number of days you output MUST equal the number of "End of Day" banners in the document (plus any prep/unscheduled days).
- A page break, repeated column header, or page footer/header does NOT close a day. Only "End of Day" banners close a day. Keep accumulating scenes across page breaks.

OTHER (non-scene, non-banner) STRIPS:
- Strips that are neither a scene nor an "End of Day" banner — e.g. "ALL SCENES SCHEDULED TODAY TO RUN TOGETHER", "ALLOW TIME FOR VFX", "Miss Edwards (#5) NA in the PM", general instructions — are appended to the CURRENT (still-open) day's "notes" field, one per line. (These never close a day.)

OTHER RULES:
- UNSCHEDULED: When you reach an "Unscheduled" / "Scenes Not Scheduled" header (usually near the end), close the current day and start ONE new day with type "unscheduled" (no dayNumber, no date). ALL scenes after that header go into this unscheduled day, even though there is NO "End of Day" banner after them. Make sure these scenes are captured — do not drop them.
- SCENE NUMBERS: Use the scene number exactly as printed. If a scene strip has NO scene number, leave "sceneNumber" as an empty string — never invent or guess a number.
- Location/venue headers (e.g. "TRING PARK SCHOOL - Shoot 22 days", "THEATRE : Shoot 2 Days") apply to the days that follow until the next location header. Put the venue name in each day's "location".
- Ignore "WEEK 1"/"WEEK 2" banners and sunrise/sunset lines.
- "PRE-SHOOT DURING PREP WEEKS" scenes are type "prep". Splinter unit work is "splinter". Normal numbered days are type "main".
- "REST DAY" entries are type "rest" (no scenes), BUT only include a rest day if it falls on a WEEKDAY (Monday–Friday). SKIP and do NOT output any rest day labelled or dated as a Saturday or Sunday (e.g. "Saturday - REST DAY", "Sunday - REST DAY") — weekend rest days are not needed.
- If a value is missing, use an empty string (or empty array for castNumbers). Do not invent data.
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`

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
      },
    }

    // Call Gemini with automatic retry/backoff on 429 (free-tier rate limits)
    // and 503 (transient overload).
    let res
    let data
    const MAX_ATTEMPTS = 4
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      data = await res.json()

      if (res.ok) break

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
        if (!waitMs) waitMs = 1500 * Math.pow(2, attempt - 1) // 1.5s, 3s, 6s
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
      break
    }

    if (!res!.ok) {
      const msg = data?.error?.message ?? 'Gemini request failed.'
      const friendly = res!.status === 429
        ? `Gemini rate limit / quota reached. ${msg} — wait a minute and try again, or check your free-tier quota at aistudio.google.com.`
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

    return new Response(JSON.stringify({ ok: true, result: parsed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
