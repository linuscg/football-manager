import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
// Try the more capable model first; fall back to the lighter one on overload.
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const responseSchema = {
  type: 'object',
  properties: {
    cast: {
      type: 'array',
      description: 'One entry per unique cast member in the cast list.',
      items: {
        type: 'object',
        properties: {
          number:    { type: 'string', description: 'The cast number exactly as printed, e.g. "1", "17", "X26". Keep any letter prefix.' },
          character: { type: 'string', description: 'The CHARACTER name (the role), e.g. "EMI", "MISS EDWARDS".' },
          artist:    { type: 'string', description: 'The ARTIST / actor name, e.g. "EDITH FAISSAT". Empty string if blank.' },
        },
        required: ['number', 'character', 'artist'],
      },
    },
  },
  required: ['cast'],
}

const PROMPT = `You are parsing a film/TV CAST LIST PDF into structured JSON.

The document lists cast members. The key data is a table with three columns:
  # (cast number)  |  CHARACTER (the role)  |  ARTIST (the actor playing them)

Rules:
- Extract EVERY cast member into "cast": { number, character, artist }.
- "number" = the value in the # column, exactly as printed. It may have a letter prefix like "X26" or "X15" (featured extras) — keep it verbatim.
- "character" = the CHARACTER column (the role name, e.g. "EMI", "BALLET GIRL 1").
- "artist" = the ARTIST column (the actor's real name, e.g. "EDITH FAISSAT"). If the artist cell is blank, use an empty string — never invent a name.
- The PDF often has a SUMMARY TABLE (all cast on one page) AND detailed per-cast pages afterwards (one card each, repeating #, character, artist plus contact/agent info we do NOT need). Output each unique cast member ONCE. If the same number+character appears in both the summary and a detail page, include it a single time. Do not duplicate.
- Ignore all other information (addresses, phone numbers, emails, agents, photos, confidentiality notices, headers/footers).
- Skip completely empty rows.
- Preserve the order in which cast members first appear.
- Return ONLY the structured JSON matching the schema.`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

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
        thinkingConfig: { thinkingBudget: 0 },
      },
    }
    const bodyStr = JSON.stringify(body)

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
          let waitMs = 0
          const details = data?.error?.details ?? []
          const retryInfo = details.find((d: { '@type'?: string; retryDelay?: string }) =>
            d['@type']?.includes('RetryInfo'))
          if (retryInfo?.retryDelay) {
            waitMs = (parseFloat(String(retryInfo.retryDelay).replace('s', '')) || 0) * 1000
          }
          if (!waitMs) waitMs = 1200 * Math.pow(2, attempt - 1)
          await new Promise(r => setTimeout(r, waitMs))
          continue
        }
        if (retryable) modelUnavailable = true
        break
      }

      if (res!.ok) break
      if (!modelUnavailable) break
    }

    if (!res!.ok) {
      const msg = data?.error?.message ?? 'Gemini request failed.'
      const friendly = (res!.status === 429 || res!.status === 503)
        ? `All cast-list parsing models are busy right now. ${msg} — please wait a minute and try again.`
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
