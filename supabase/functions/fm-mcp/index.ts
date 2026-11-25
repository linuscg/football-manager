// ─── Football Manager MCP server (Claude / ChatGPT connector) ────────────────
//
// A remote MCP server (Streamable HTTP, stateless JSON responses) that lets an
// AI assistant read a user's productions. Phase 1: READ-ONLY tools.
//
// Auth: OAuth 2.1 via Supabase Auth's OAuth server. An unauthenticated call
// gets a 401 whose WWW-Authenticate header points at this function's
// protected-resource metadata, which names Supabase Auth as the authorization
// server; the client then registers itself (dynamic client registration),
// sends the user to /oauth/consent on footballmanager.xyz, and comes back with
// a user access token. Every query below runs AS THAT USER (their JWT is
// forwarded), so RLS applies exactly as in the app: membership, tab gates,
// hidden rates. On top of that each tool checks the same per-user tab/module
// permissions the app's nav uses. Writes made with OAuth tokens are blocked
// in the database (oauth_no_* restrictive policies).
//
// Deploy with --no-verify-jwt: discovery requests arrive without a token, and
// this function verifies tokens itself (auth.getUser, which also rejects
// revoked grants).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SELF_URL     = `${SUPABASE_URL}/functions/v1/fm-mcp`
const METADATA_URL = `${SELF_URL}/.well-known/oauth-protected-resource`

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

const cors = {
  'Access-Control-Allow-Origin':   '*',
  'Access-Control-Allow-Headers':  'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id, x-client-info, apikey',
  'Access-Control-Allow-Methods':  'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } })

// ─── Small helpers ───────────────────────────────────────────────────────────

class ToolError extends Error {}

const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
function dateArg(v: unknown, name: string): string | null {
  if (v == null || v === '') return null
  if (!isDate(v)) throw new ToolError(`${name} must be a date as YYYY-MM-DD`)
  return v as string
}
const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()
const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)))

// Collapse sorted ISO dates into "from–to" runs.
function dateRuns(dates: string[]): string[] {
  const ds = [...new Set(dates)].sort()
  const out: string[] = []
  let start: string | null = null, prev: string | null = null
  for (const d of ds) {
    if (prev && addDays(prev, 1) === d) { prev = d; continue }
    if (start) out.push(start === prev ? start : `${start} to ${prev}`)
    start = prev = d
  }
  if (start) out.push(start === prev ? start : `${start} to ${prev}`)
  return out
}

// Supabase caps reads at 1,000 rows — page everything.
// deno-lint-ignore no-explicit-any
async function paged(make: () => any): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}
// .in() filters go in the URL — chunk long id lists.
// deno-lint-ignore no-explicit-any
async function pagedIn(ids: string[], make: (chunk: string[]) => any): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 150) out.push(...await paged(() => make(ids.slice(i, i + 150))))
  return out
}

// ─── Per-request context (the signed-in user) ────────────────────────────────

interface Ctx {
  db: SupabaseClient
  userId: string
  isAppOwner: boolean
  // deno-lint-ignore no-explicit-any
  productions?: any[]
}

async function productionsFor(ctx: Ctx) {
  if (ctx.productions) return ctx.productions
  const [{ data: prods, error }, { data: mems }] = await Promise.all([
    ctx.db.from('production').select('id, name, disabled, prep_start_date, shoot_start_date, shoot_end_date, wrap_end_date'),
    ctx.db.from('production_members').select('production_id, role').eq('user_id', ctx.userId),
  ])
  if (error) throw new Error(error.message)
  const roleOf = new Map((mems ?? []).map(m => [m.production_id, m.role]))
  ctx.productions = (prods ?? [])
    .filter(p => ctx.isAppOwner || (!p.disabled && roleOf.has(p.id)))
    .map(p => ({ ...p, role: roleOf.get(p.id) ?? (ctx.isAppOwner ? 'app owner' : null) }))
  return ctx.productions
}

async function resolveProduction(ctx: Ctx, arg: unknown) {
  const prods = await productionsFor(ctx)
  if (!prods.length) throw new ToolError('You are not a member of any production.')
  const a = norm(arg)
  if (!a) {
    if (prods.length === 1) return prods[0]
    throw new ToolError(`Which production? Pass "production" as one of: ${prods.map(p => p.name).join(', ')}`)
  }
  const exact = prods.find(p => p.id === arg || norm(p.name) === a)
  if (exact) return exact
  const partial = prods.filter(p => norm(p.name).includes(a))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) throw new ToolError(`"${arg}" matches several productions: ${partial.map(p => p.name).join(', ')}`)
  throw new ToolError(`No production called "${arg}". Yours: ${prods.map(p => p.name).join(', ')}`)
}

// Same per-user nav permissions the app enforces (owners bypass inside the RPC).
async function requireAccess(ctx: Ctx, prodId: string, tab: string, module: string, what: string) {
  if (ctx.isAppOwner) return
  const { data, error } = await ctx.db.rpc('member_can_access', { prod: prodId, tab, module })
  if (error) throw new Error(error.message)
  if (!data) throw new ToolError(`You don't have access to ${what} on this production.`)
}
async function canAccess(ctx: Ctx, prodId: string, tab: string, module: string) {
  try { await requireAccess(ctx, prodId, tab, module, ''); return true } catch { return false }
}

// ─── Data loaders ────────────────────────────────────────────────────────────

async function loadDays(ctx: Ctx, prodId: string) {
  return await paged(() => ctx.db.from('shoot_days')
    .select('id, day_number, date, day_label, day_category, day_type, is_non_shoot_day, location, locations, unit_base, general_call, wrap_time, notes, description, sort_order')
    .eq('production_id', prodId).order('sort_order'))
}
async function loadCast(ctx: Ctx, prodId: string) {
  return await paged(() => ctx.db.from('cast_members').select('id, cast_number, name, role, notes').eq('production_id', prodId).order('sort_order'))
}
// deno-lint-ignore no-explicit-any
const dayName = (d: any) => d.day_category === 'unscheduled' ? 'Unscheduled'
  : d.day_label || (d.day_category === 'main' && d.day_number != null ? `Day ${d.day_number}` : d.day_category)

// deno-lint-ignore no-explicit-any
function saTotal(rows: any[]) {
  let total = 0
  const linkMax = new Map<string, number>()
  for (const r of rows) {
    if (norm(r.category) !== 'extras') continue
    const n = Number(r.total_number) || 0
    if (r.link_key) linkMax.set(r.link_key, Math.max(linkMax.get(r.link_key) ?? 0, n))
    else total += n
  }
  for (const n of linkMax.values()) total += n
  return total
}

const CAT_LABEL: Record<string, string> = {
  animals: 'Animals', risk: 'Risk Assessments', stunts: 'Stunts', vfx: 'VFX', extras: 'Supporting Artists',
  standins: 'Stand-ins', other: 'Other', visitors: 'Visitors', props: 'Props', wardrobe: 'Wardrobe',
  makeup: 'Makeup / Hair', sfx: 'SFX', art: 'Art Dept', vehicles: 'Vehicles', weapons: 'Weapons',
  labour: 'Additional Labour', notes: 'Notes',
}
// deno-lint-ignore no-explicit-any
const extraText = (e: any) => norm(e.category) === 'extras' || norm(e.category) === 'standins'
  ? [e.dood_id ? `#${e.dood_id}` : '', e.sa_name || e.description, e.total_number ? `×${e.total_number}` : ''].filter(Boolean).join(' ')
  : (e.description || e.sa_name || '')

// ─── Tools ───────────────────────────────────────────────────────────────────

const PROD_PARAM = { type: 'string', description: 'Production name (or id). Optional if the user only has one production.' }

// deno-lint-ignore no-explicit-any
type Handler = (ctx: Ctx, args: any) => Promise<unknown>
interface Tool { name: string; title: string; description: string; inputSchema: Record<string, unknown>; run: Handler }

const TOOLS: Tool[] = [
  {
    name: 'list_productions',
    title: 'List productions',
    description: 'List the productions this user belongs to, with their role and key dates. Call this first if unsure which production the user means.',
    inputSchema: { type: 'object', properties: {} },
    run: async (ctx) => {
      const prods = await productionsFor(ctx)
      return { today: londonToday(), productions: prods.map(p => clean({ name: p.name, id: p.id, your_role: p.role, prep_start: p.prep_start_date, shoot_start: p.shoot_start_date, shoot_end: p.shoot_end_date, wrap_end: p.wrap_end_date })) }
    },
  },
  {
    name: 'get_production_overview',
    title: 'Production overview',
    description: 'Key facts for a production: prep/shoot/wrap dates, hiatuses, shoot-day count, crew and cast headcounts.',
    inputSchema: { type: 'object', properties: { production: PROD_PARAM } },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      const { data: full } = await ctx.db.from('production').select('name, prep_start_date, prep_end_date, shoot_start_date, shoot_end_date, wrap_start_date, wrap_end_date, hiatuses, format, episode_count, currency').eq('id', p.id).single()
      const days = await loadDays(ctx, p.id)
      const shootDays = days.filter(d => d.day_category === 'main' && !d.is_non_shoot_day)
      const { count: crewCount } = await ctx.db.from('resources').select('id', { count: 'exact', head: true }).eq('production_id', p.id).eq('type', 'crew')
      const { count: castCount } = await ctx.db.from('cast_members').select('id', { count: 'exact', head: true }).eq('production_id', p.id)
      return clean({
        ...full, your_role: p.role, today: londonToday(),
        shoot_days: shootDays.length,
        first_shoot_day: shootDays.map(d => d.date).filter(Boolean).sort()[0],
        last_shoot_day: shootDays.map(d => d.date).filter(Boolean).sort().at(-1),
        crew_on_tracker: crewCount, cast: castCount,
      })
    },
  },
  {
    name: 'get_schedule',
    title: 'Shooting schedule',
    description: 'Shooting schedule between two dates (default: today + 13 days): each day with its scenes (number, INT/EXT, set, D/N, pages, cast numbers), locations, calls and supporting-artist totals. Set include_unscheduled to also list scenes parked on Unscheduled.',
    inputSchema: {
      type: 'object',
      properties: {
        production: PROD_PARAM,
        from_date: { type: 'string', description: 'YYYY-MM-DD (default today)' },
        to_date: { type: 'string', description: 'YYYY-MM-DD (default from_date + 13 days)' },
        include_unscheduled: { type: 'boolean' },
      },
    },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      await requireAccess(ctx, p.id, 'fm', 'schedule', 'the Schedule')
      const from = dateArg(a.from_date, 'from_date') ?? londonToday()
      const to = dateArg(a.to_date, 'to_date') ?? addDays(from, 13)
      const days = (await loadDays(ctx, p.id)).filter(d =>
        (d.date && d.date >= from && d.date <= to) || (a.include_unscheduled && d.day_category === 'unscheduled'))
      const ids = days.map(d => d.id)
      const [scenes, extras, cast] = await Promise.all([
        pagedIn(ids, c => ctx.db.from('scenes').select('id, day_id, scene_number, int_ext, location, day_night, description, pages, story_day, episode_number, cast_member_ids, sort_order').in('day_id', c).order('sort_order')),
        pagedIn(ids, c => ctx.db.from('day_extras').select('day_id, category, total_number, link_key').in('day_id', c)),
        loadCast(ctx, p.id),
      ])
      const castNum = new Map(cast.map(c => [c.id, c.cast_number || c.name]))
      return {
        production: p.name, from, to,
        days: days.sort((x, y) => (x.date ?? '9999').localeCompare(y.date ?? '9999') || x.sort_order - y.sort_order).map(d => clean({
          date: d.date, day: dayName(d), category: d.day_category, type: d.day_type,
          location: d.location, locations: Array.isArray(d.locations) ? d.locations.map((l: unknown) => typeof l === 'string' ? l : (l as { name?: string })?.name).filter(Boolean) : undefined,
          unit_base: d.unit_base, general_call: d.general_call, wrap: d.wrap_time, notes: d.notes || d.description,
          supporting_artists: saTotal(extras.filter(e => e.day_id === d.id)) || undefined,
          scenes: scenes.filter(s => s.day_id === d.id).map(s => clean({
            scene: s.scene_number, ep: s.episode_number, int_ext: s.int_ext, set: s.location, day_night: s.day_night,
            pages: s.pages, story_day: s.story_day, synopsis: s.description,
            cast: (s.cast_member_ids ?? []).map((id: string) => castNum.get(id) ?? id),
          })),
        })),
      }
    },
  },
  {
    name: 'get_scene',
    title: 'Scene details',
    description: 'Everything about one scene: when it is scheduled, set, cast (names), and its Additional Info from the breakdown (props, wardrobe, SFX, stunts, supporting artists, vehicles, notes…).',
    inputSchema: {
      type: 'object',
      properties: { production: PROD_PARAM, scene_number: { type: 'string', description: 'e.g. "24" or "24A"' } },
      required: ['scene_number'],
    },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      await requireAccess(ctx, p.id, 'fm', 'schedule', 'the Schedule')
      const days = await loadDays(ctx, p.id)
      const dayById = new Map(days.map(d => [d.id, d]))
      const want = norm(a.scene_number)
      const all = await pagedIn(days.map(d => d.id), c => ctx.db.from('scenes').select('id, day_id, scene_number, int_ext, location, day_night, description, pages, story_day, episode_number, cast_member_ids').in('day_id', c))
      const base = (s: string) => norm(s).replace(/\s*(pt\.?\s*\d.*|cont.*)$/, '')
      let hits = all.filter(s => norm(s.scene_number) === want)
      if (!hits.length) hits = all.filter(s => base(s.scene_number) === base(want))
      if (!hits.length) throw new ToolError(`No scene ${a.scene_number} on ${p.name}'s schedule.`)
      const cast = await loadCast(ctx, p.id)
      const castBy = new Map(cast.map(c => [c.id, c]))
      const extras = await pagedIn(hits.map(h => h.id), c => ctx.db.from('day_extras').select('scene_id, category, description, sa_name, total_number, dood_id').in('scene_id', c).order('sort_order'))
      return {
        production: p.name,
        strips: hits.map(s => {
          const d = dayById.get(s.day_id)
          const info: Record<string, string[]> = {}
          for (const e of extras.filter(x => x.scene_id === s.id)) {
            const k = CAT_LABEL[norm(e.category)] ?? e.category
            ;(info[k] ??= []).push(extraText(e))
          }
          return clean({
            scene: s.scene_number, ep: s.episode_number, scheduled: d ? clean({ date: d.date, day: dayName(d) }) : undefined,
            int_ext: s.int_ext, set: s.location, day_night: s.day_night, pages: s.pages, story_day: s.story_day, synopsis: s.description,
            cast: (s.cast_member_ids ?? []).map((id: string) => { const c = castBy.get(id); return c ? clean({ number: c.cast_number, name: c.name, role: c.role }) : id }),
            additional_info: Object.keys(info).length ? info : undefined,
          })
        }),
      }
    },
  },
  {
    name: 'list_cast',
    title: 'Cast list',
    description: 'The cast list: cast number, actor name, character.',
    inputSchema: { type: 'object', properties: { production: PROD_PARAM } },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      await requireAccess(ctx, p.id, 'fm', 'schedule', 'the Schedule')
      return { production: p.name, cast: (await loadCast(ctx, p.id)).map(c => clean({ number: c.cast_number, name: c.name, character: c.role, notes: c.notes })) }
    },
  },
  {
    name: 'list_crew',
    title: 'Crew list',
    description: 'Crew on the Crew Tracker with department, role, hire dates and contact details. Filter by department, by a name/role search, or to who is booked on a given date. Rates are included only if this user is allowed to see them.',
    inputSchema: {
      type: 'object',
      properties: {
        production: PROD_PARAM,
        department: { type: 'string' },
        search: { type: 'string', description: 'Matches name or role' },
        working_on: { type: 'string', description: 'YYYY-MM-DD — only crew booked that day' },
      },
    },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      await requireAccess(ctx, p.id, 'crew-times', 'ct-tracker', 'the Crew Tracker')
      const on = dateArg(a.working_on, 'working_on')
      let crew = await paged(() => ctx.db.from('resources')
        .select('id, name, department, role, crew_class, level, is_hod, hire_start_date, hire_end_date, contact_email, contact_phone, agent, notes, resource_rates(cost_amount, cost_type, week_type)')
        .eq('production_id', p.id).eq('type', 'crew').order('sort_order'))
      if (a.department) crew = crew.filter(c => norm(c.department).includes(norm(a.department)))
      if (a.search) crew = crew.filter(c => norm(c.name).includes(norm(a.search)) || norm(c.role).includes(norm(a.search)))
      if (on) {
        const booked = new Set((await pagedIn(crew.map(c => c.id), c => ctx.db.from('resource_bookings').select('resource_id, status').in('resource_id', c).eq('booking_date', on)))
          .filter(b => b.status !== 'unavailable').map(b => b.resource_id))
        crew = crew.filter(c => booked.has(c.id))
      }
      return {
        production: p.name, count: crew.length, ...(on ? { working_on: on } : {}),
        crew: crew.map(c => {
          const rate = Array.isArray(c.resource_rates) ? c.resource_rates[0] : c.resource_rates
          return clean({
            name: c.name, department: c.department, role: c.role, type: c.crew_class, hod: c.is_hod || undefined,
            start: c.hire_start_date, end: c.hire_end_date, email: c.contact_email, phone: c.contact_phone, agent: c.agent, notes: c.notes,
            rate: rate?.cost_amount != null ? clean({ amount: rate.cost_amount, per: rate.cost_type, week: rate.week_type }) : undefined,
          })
        }),
      }
    },
  },
  {
    name: 'get_bookings',
    title: 'Booked dates',
    description: 'The dates a crew member or piece of equipment is booked (and any holds/unavailable days), as date ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        production: PROD_PARAM,
        name: { type: 'string', description: 'Crew member or equipment name (partial match ok)' },
        from_date: { type: 'string' }, to_date: { type: 'string' },
      },
      required: ['name'],
    },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      const from = dateArg(a.from_date, 'from_date'), to = dateArg(a.to_date, 'to_date')
      const rows = (await paged(() => ctx.db.from('resources').select('id, name, type, department, role, hire_start_date, hire_end_date').eq('production_id', p.id)))
        .filter(r => norm(r.name).includes(norm(a.name)))
      const [seeCrew, seeEquip] = await Promise.all([canAccess(ctx, p.id, 'crew-times', 'ct-tracker'), canAccess(ctx, p.id, 'fm', 'crew')])
      const allowed = rows.filter(r => r.type === 'crew' ? seeCrew : seeEquip)
      if (!allowed.length) throw new ToolError(`Nobody/nothing called "${a.name}" on ${p.name} that you can see.`)
      if (allowed.length > 8) throw new ToolError(`"${a.name}" matches ${allowed.length} entries — be more specific (e.g. ${allowed.slice(0, 5).map(r => r.name).join(', ')}).`)
      const bookings = await pagedIn(allowed.map(r => r.id), c => {
        let q = ctx.db.from('resource_bookings').select('resource_id, booking_date, status').in('resource_id', c)
        if (from) q = q.gte('booking_date', from)
        if (to) q = q.lte('booking_date', to)
        return q
      })
      return {
        production: p.name,
        results: allowed.map(r => {
          const mine = bookings.filter(b => b.resource_id === r.id)
          const byStatus: Record<string, string[]> = {}
          for (const b of mine) (byStatus[b.status] ??= []).push(b.booking_date)
          return clean({
            name: r.name, kind: r.type, department: r.department, role: r.role, hire_start: r.hire_start_date, hire_end: r.hire_end_date,
            days_booked: (byStatus.booked ?? []).length,
            ...Object.fromEntries(Object.entries(byStatus).map(([s, ds]) => [s, dateRuns(ds)])),
          })
        }),
      }
    },
  },
  {
    name: 'list_equipment',
    title: 'Equipment list',
    description: 'Equipment on the Equipment gantt: department, vendor, PO, hire dates. Optionally only items on hire on a given date.',
    inputSchema: { type: 'object', properties: { production: PROD_PARAM, on_hire_on: { type: 'string', description: 'YYYY-MM-DD' }, search: { type: 'string' } } },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      await requireAccess(ctx, p.id, 'fm', 'crew', 'Equipment')
      const on = dateArg(a.on_hire_on, 'on_hire_on')
      let eq = await paged(() => ctx.db.from('resources').select('id, name, department, category, vendor, po_number, cost_code, equip_class, hire_start_date, hire_end_date, notes, set_status')
        .eq('production_id', p.id).eq('type', 'equipment').order('sort_order'))
      if (a.search) eq = eq.filter(e => [e.name, e.department, e.vendor, e.category].some(v => norm(v).includes(norm(a.search))))
      if (on) eq = eq.filter(e => e.hire_start_date && e.hire_start_date <= on && (!e.hire_end_date || e.hire_end_date >= on))
      return {
        production: p.name, count: eq.length,
        equipment: eq.map(e => clean({ name: e.name, department: e.department, category: e.category, vendor: e.vendor, po: e.po_number, cost_code: e.cost_code, kind: e.equip_class === 'ros' ? 'run of show' : e.equip_class, on_hire: e.hire_start_date, off_hire: e.hire_end_date, status: e.set_status, notes: e.notes })),
      }
    },
  },
  {
    name: 'get_transport_log',
    title: 'Transport log',
    description: 'Trips from the Transport Log (cabs, couriers, drivers, transfers…) with costs, plus spend totals by department and by type. Filter by date range, department or type.',
    inputSchema: {
      type: 'object',
      properties: {
        production: PROD_PARAM, from_date: { type: 'string' }, to_date: { type: 'string' },
        department: { type: 'string' }, type: { type: 'string', description: 'e.g. Cab, Courier, Unit Driver, Airport Transfer' },
      },
    },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      await requireAccess(ctx, p.id, 'transport', 'tr-log', 'the Transport Log')
      const from = dateArg(a.from_date, 'from_date'), to = dateArg(a.to_date, 'to_date')
      let rows = await paged(() => ctx.db.from('transport_log').select('type, department, date, time, description, from_location, to_location, driver, supplier, po, cost, notes').eq('production_id', p.id).order('date'))
      if (from) rows = rows.filter(r => r.date && r.date >= from)
      if (to) rows = rows.filter(r => r.date && r.date <= to)
      if (a.department) rows = rows.filter(r => norm(r.department) === norm(a.department) || (norm(a.department) === 'unassigned' && !r.department))
      if (a.type) rows = rows.filter(r => norm(r.type) === norm(a.type))
      const sum = (key: string) => {
        const m: Record<string, number> = {}
        for (const r of rows) { const k = r[key] || 'Unassigned'; m[k] = Math.round(((m[k] ?? 0) + (Number(r.cost) || 0)) * 100) / 100 }
        return m
      }
      return {
        production: p.name, trips: rows.length,
        total: Math.round(rows.reduce((s, r) => s + (Number(r.cost) || 0), 0) * 100) / 100,
        by_department: sum('department'), by_type: sum('type'),
        log: rows.slice(-300).map(r => clean({ date: r.date, time: r.time, type: r.type, department: r.department, description: r.description, from: r.from_location, to: r.to_location, driver: r.driver, supplier: r.supplier, po: r.po, cost: r.cost, notes: r.notes })),
        ...(rows.length > 300 ? { note: `Showing the latest 300 of ${rows.length} trips; totals cover all of them.` } : {}),
      }
    },
  },
  {
    name: 'get_accommodation',
    title: 'Accommodation',
    description: 'Accommodation log: who is staying where. With a date, lists everyone in a hotel that night grouped by hotel; otherwise each stay with its date ranges.',
    inputSchema: { type: 'object', properties: { production: PROD_PARAM, date: { type: 'string', description: 'YYYY-MM-DD night' }, search: { type: 'string', description: 'Person name' } } },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      await requireAccess(ctx, p.id, 'accomm', 'accomm-crew', 'the Accommodation Log')
      const night = dateArg(a.date, 'date')
      const [stays, hotels] = await Promise.all([
        paged(() => ctx.db.from('accom_stays').select('id, name, job_title, department, room_type, cost_per_night, note').eq('production_id', p.id).order('sort_order')),
        paged(() => ctx.db.from('hotels').select('id, name, address, checkin_time, checkout_time').eq('production_id', p.id)),
      ])
      const hotelName = new Map(hotels.map(h => [h.id, h.name]))
      let mine = stays
      if (a.search) mine = mine.filter(s => norm(s.name).includes(norm(a.search)))
      const nights = await pagedIn(mine.map(s => s.id), c => {
        let q = ctx.db.from('accom_nights').select('stay_id, date, hotel_id, tbc').in('stay_id', c)
        if (night) q = q.eq('date', night)
        return q
      })
      if (night) {
        const byHotel: Record<string, string[]> = {}
        for (const n of nights) {
          const s = mine.find(x => x.id === n.stay_id); if (!s) continue
          const h = n.tbc ? 'TBC' : (hotelName.get(n.hotel_id) ?? 'Unknown hotel')
          ;(byHotel[h] ??= []).push([s.name, s.job_title || s.department].filter(Boolean).join(' — '))
        }
        return { production: p.name, night, people: nights.length, by_hotel: byHotel }
      }
      return {
        production: p.name,
        stays: mine.map(s => {
          const ns = nights.filter(n => n.stay_id === s.id)
          const perHotel: Record<string, string[]> = {}
          for (const n of ns) (perHotel[n.tbc ? 'TBC' : (hotelName.get(n.hotel_id) ?? 'Unknown hotel')] ??= []).push(n.date)
          return clean({
            name: s.name, role: s.job_title, department: s.department, room: s.room_type, cost_per_night: s.cost_per_night, note: s.note,
            nights: ns.length, hotels: Object.fromEntries(Object.entries(perHotel).map(([h, ds]) => [h, dateRuns(ds)])),
          })
        }).filter(s => s.nights || a.search),
      }
    },
  },
  {
    name: 'get_day',
    title: 'What\'s happening on a day',
    description: 'One-stop summary of a date: the shoot day and its scenes, supporting-artist count, crew starting/finishing, equipment on/off hire and transport trips. Defaults to today.',
    inputSchema: { type: 'object', properties: { production: PROD_PARAM, date: { type: 'string', description: 'YYYY-MM-DD (default today)' } } },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      const date = dateArg(a.date, 'date') ?? londonToday()
      const out: Record<string, unknown> = { production: p.name, date }
      if (await canAccess(ctx, p.id, 'fm', 'schedule')) {
        const days = (await loadDays(ctx, p.id)).filter(d => d.date === date)
        const ids = days.map(d => d.id)
        const [scenes, extras] = await Promise.all([
          pagedIn(ids, c => ctx.db.from('scenes').select('day_id, scene_number, int_ext, location, day_night, pages').in('day_id', c).order('sort_order')),
          pagedIn(ids, c => ctx.db.from('day_extras').select('day_id, category, total_number, link_key').in('day_id', c)),
        ])
        out.schedule = days.length ? days.map(d => clean({
          day: dayName(d), type: d.day_type, location: d.location, unit_base: d.unit_base, general_call: d.general_call, wrap: d.wrap_time, notes: d.notes,
          supporting_artists: saTotal(extras.filter(e => e.day_id === d.id)) || undefined,
          scenes: scenes.filter(s => s.day_id === d.id).map(s => [s.scene_number, s.int_ext, s.location, s.day_night, s.pages ? `${s.pages}pg` : ''].filter(Boolean).join(' ')),
        })) : 'Not a scheduled day'
      }
      if (await canAccess(ctx, p.id, 'crew-times', 'ct-tracker')) {
        const crew = await paged(() => ctx.db.from('resources').select('name, department, role, hire_start_date, hire_end_date').eq('production_id', p.id).eq('type', 'crew'))
        const fmt = (c: { name: string; role: string; department: string }) => [c.name, c.role || c.department].filter(Boolean).join(' — ')
        out.crew_starting = crew.filter(c => c.hire_start_date === date).map(fmt)
        out.crew_finishing = crew.filter(c => c.hire_end_date === date).map(fmt)
      }
      if (await canAccess(ctx, p.id, 'fm', 'crew')) {
        const eq = await paged(() => ctx.db.from('resources').select('name, vendor, hire_start_date, hire_end_date').eq('production_id', p.id).eq('type', 'equipment'))
        out.equipment_on_hire = eq.filter(e => e.hire_start_date === date).map(e => [e.name, e.vendor].filter(Boolean).join(' — '))
        out.equipment_off_hire = eq.filter(e => e.hire_end_date === date).map(e => [e.name, e.vendor].filter(Boolean).join(' — '))
      }
      if (await canAccess(ctx, p.id, 'transport', 'tr-log')) {
        const trips = await paged(() => ctx.db.from('transport_log').select('time, type, department, description, from_location, to_location, driver').eq('production_id', p.id).eq('date', date).order('time'))
        out.transport = trips.map(t => clean({ time: t.time, type: t.type, department: t.department, description: t.description, from: t.from_location, to: t.to_location, driver: t.driver }))
      }
      return clean(out)
    },
  },
  {
    name: 'get_activity_log',
    title: 'Recent changes',
    description: 'Who changed what, and when (in the app, through an AI assistant, or by automatic syncs). Production owners/admins only.',
    inputSchema: {
      type: 'object',
      properties: { production: PROD_PARAM, since: { type: 'string', description: 'YYYY-MM-DD (default 7 days ago)' }, limit: { type: 'number', description: 'Max entries (default 100, max 500)' } },
    },
    run: async (ctx, a) => {
      const p = await resolveProduction(ctx, a.production)
      const since = dateArg(a.since, 'since') ?? addDays(londonToday(), -7)
      const limit = Math.min(Math.max(Number(a.limit) || 100, 1), 500)
      const { data, error } = await ctx.db.from('activity_log').select('at, actor_name, source, table_name, op, label, changes')
        .eq('production_id', p.id).gte('at', since).order('at', { ascending: false }).limit(limit)
      if (error) throw new Error(error.message)
      if (!data?.length && !['owner', 'admin', 'app owner'].includes(p.role)) throw new ToolError('The activity log is only visible to production owners and admins.')
      return { production: p.name, since, entries: data }
    },
  },
]

const INSTRUCTIONS = `Football Manager is a film/TV production management app (schedule, crew tracker, equipment, transport, accommodation).
These tools are READ-ONLY for now. Most tools take an optional "production" (name or id) — call list_productions if the user has several and it's unclear which one they mean.
Dates are YYYY-MM-DD in UK time; "today" is ${'${today}'}. Prefer get_day for "what's happening on <date>" questions and get_schedule for date ranges.
Crew contact details are real people's personal data: only surface them when the user asks.`

// ─── JSON-RPC dispatch ───────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleRpc(ctx: Ctx, msg: any): Promise<unknown | null> {
  const { id, method, params } = msg ?? {}
  const isNotification = id === undefined || id === null
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'Invalid request')
  if (isNotification) return null

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'football-manager', title: 'Football Manager', version: '1.0.0' },
        instructions: INSTRUCTIONS.replace('${today}', londonToday()),
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({
        tools: TOOLS.map(t => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })),
      })
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params?.name)
      if (!tool) return err(-32602, `Unknown tool: ${params?.name}`)
      try {
        const result = await tool.run(ctx, params?.arguments ?? {})
        return ok({ content: [{ type: 'text', text: JSON.stringify(result) }] })
      } catch (e) {
        const message = e instanceof ToolError ? e.message : `Football Manager error: ${(e as Error).message}`
        if (!(e instanceof ToolError)) console.error('[fm-mcp]', tool.name, e)
        return ok({ content: [{ type: 'text', text: message }], isError: true })
      }
    }
    case 'resources/list': return ok({ resources: [] })
    case 'prompts/list':   return ok({ prompts: [] })
    default:
      return err(-32601, `Method not found: ${method}`)
  }
}

// ─── HTTP entry ──────────────────────────────────────────────────────────────

const unauthorized = (why: string) => json(
  { jsonrpc: '2.0', id: null, error: { code: -32001, message: why } }, 401,
  { 'WWW-Authenticate': `Bearer resource_metadata="${METADATA_URL}"` },
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const path = new URL(req.url).pathname

  // RFC 9728 protected-resource metadata
  if (req.method === 'GET' && path.endsWith('/.well-known/oauth-protected-resource')) {
    return json({
      resource: SELF_URL,
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'],
      resource_name: 'Football Manager',
      resource_documentation: 'https://footballmanager.xyz',
    })
  }

  if (req.method !== 'POST') {
    // Stateless server: no SSE stream, no sessions to delete.
    return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed' } }, 405, { Allow: 'POST' })
  }

  const token = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return unauthorized('Sign in to Football Manager to use this connector.')

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await db.auth.getUser(token)
  if (userErr || !userData?.user) return unauthorized('Your Football Manager sign-in has expired or was revoked — reconnect the connector.')

  const { data: prof } = await db.from('profiles').select('is_owner').eq('id', userData.user.id).maybeSingle()
  const ctx: Ctx = { db, userId: userData.user.id, isAppOwner: prof?.is_owner === true }

  let body: unknown
  try { body = await req.json() } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400) }

  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map(m => handleRpc(ctx, m)))).filter(r => r !== null)
    return replies.length ? json(replies) : new Response(null, { status: 202, headers: cors })
  }
  const reply = await handleRpc(ctx, body)
  return reply === null ? new Response(null, { status: 202, headers: cors }) : json(reply)
})
