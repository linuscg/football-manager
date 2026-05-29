import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const MODEL = 'gemini-2.0-flash'

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
          type:      { type: 'string', enum: ['main', 'prep', 'rest', 'splinter'], description: 'main = numbered shoot day; prep/pre-shoot = prep; rest = rest day; splinter = splinter unit.' },
          dayNumber: { type: 'integer', description: 'Shoot day number for main days, else null/0.', nullable: true },
          date:      { type: 'string', description: 'ISO date YYYY-MM-DD if known, else empty string.' },
          location:  { type: 'string', description: 'Location/venue header that applies to this day, e.g. "TRING PARK SCHOOL". Empty if unknown.' },
          weekLabel: { type: 'string', description: 'Week banner this day falls under, e.g. "WEEK 1". Empty if none.' },
          notes:     { type: 'string', description: 'Any day-level banner text or notes (e.g. "ALLOW TIME FOR VFX", sunrise/sunset, free-text notes). Empty if none.' },
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

Rules:
- The first page is usually a CAST MEMBERS legend: a numbered list mapping a cast number to a character name. Extract every entry into "cast".
- The body is a sequence of scene rows grouped into shooting days. Each scene row has: a scene number (bold, left), an optional dance-sequence label printed beneath it (e.g. KNOCK, ANI, DANCE, BALLET — capture as danceSequence), INT/EXT, a bold SET name, a description line, a time-of-day word (Morning/Day/Dusk/Evening/Night) with a story-day number beneath it, a page count ("Pgs"), a cast list after "C:", and an "SA's:" count.
- Day boundaries are marked by banners like "--- End of Day #1 -- Monday, 20 July 2026 --- Total Pgs ...". Use these to (a) close the current day, (b) set that day's dayNumber and date (convert the printed date to ISO YYYY-MM-DD).
- Location/venue headers (e.g. "TRING PARK SCHOOL - Shoot 22 days", "THEATRE : Shoot 2 Days") apply to the days that follow until the next location header. Put the venue name in each day's "location".
- "WEEK 1"/"WEEK 2" banners set weekLabel for following days.
- "PRE-SHOOT DURING PREP WEEKS" scenes are type "prep". "REST DAY" entries are type "rest" days (no scenes). Splinter unit work is "splinter".
- Capture any free-text banners/notes for a day into that day's "notes".
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

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.error?.message ?? 'Gemini request failed.', detail: data }), {
        status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
