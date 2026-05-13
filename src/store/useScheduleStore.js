import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { markIdsNotified } from '../lib/ganttNotified'
import {
  getCurrentProductionId,
  setCurrentProductionId,
  onProductionChange,
} from '../lib/productionContext'

// ─── Row mappers (snake_case DB → camelCase React) ────────────────────────────

function groupExtrasByCategory(extras) {
  const out = {}
  for (const e of extras ?? []) {
    if (!out[e.category]) out[e.category] = []
    out[e.category].push({ id: e.id, description: e.description, sortOrder: e.sort_order })
  }
  return out
}

function mapDay(row, scenes = [], extras = []) {
  // Support both the legacy single `location` text column and the new `locations`
  // jsonb array. The derived `location` field (first element) keeps all existing
  // code working without changes.
  const rawLocs = Array.isArray(row.locations) ? row.locations : []
  const locArr  = rawLocs.length
    ? rawLocs
    : (row.location ? [row.location] : [])

  return {
    id:            row.id,
    dayNumber:     row.day_number      ?? null,
    date:          row.date            ?? '',
    location:      locArr[0]           ?? '',      // backward-compat
    locations:     locArr.length ? locArr : [''],  // always ≥ 1 slot for the UI
    unitBase:      row.unit_base       ?? '',
    generalCall:   row.general_call    ?? '',
    dayType:       row.day_type        ?? '',
    isNonShootDay: row.is_non_shoot_day ?? false,
    description:   row.description     ?? '',
    notes:         row.notes           ?? '',
    sortOrder:     row.sort_order      ?? 0,
    dayCategory:   row.day_category    ?? 'main',
    dayLabel:      row.day_label       ?? '',
    scenes:        scenes.map(mapScene).sort((a, b) => a.sortOrder - b.sortOrder),
    extras:        groupExtrasByCategory(extras),
  }
}

function mapScene(row) {
  return {
    id:            row.id,
    sceneNumber:   row.scene_number   ?? '',
    intExt:        row.int_ext        ?? 'INT',
    location:      row.location       ?? '',
    dayNight:      row.day_night      ?? 'DAY',
    description:   row.description    ?? '',
    pages:         row.pages          ?? '',
    sortOrder:     row.sort_order     ?? 0,
    castMemberIds: row.cast_member_ids ?? [],
    episodeNumber: row.episode_number  ?? null,
  }
}

function mapProduction(row) {
  return {
    id:             row.id,
    name:           row.name            ?? 'Untitled Production',
    currency:       row.currency        ?? '£',
    exchangeRates:  row.exchange_rates  ?? {},
    prepStartDate:  row.prep_start_date  ?? '',
    prepEndDate:    row.prep_end_date    ?? '',
    shootStartDate: row.shoot_start_date ?? '',
    shootEndDate:   row.shoot_end_date   ?? '',
    wrapStartDate:  row.wrap_start_date  ?? '',
    wrapEndDate:    row.wrap_end_date    ?? '',
    defaultDayType: row.default_day_type ?? 'SWD',
    workHours:      row.work_hours       ?? 10,
    swdLunch:       row.swd_lunch        ?? 60,
    cwdLunch:       row.cwd_lunch        ?? 0,
    scwdLunch:      row.scwd_lunch       ?? 30,
    format:         row.format           ?? 'film',
    episodeCount:   row.episode_count    ?? null,
  }
}

function mapProductionSummary(row) {
  return { id: row.id, name: row.name ?? 'Untitled Production' }
}

function mapCastMember(row) {
  return {
    id:          row.id,
    name:        row.name        ?? '',
    role:        row.role        ?? '',
    sortOrder:   row.sort_order  ?? 0,
    castNumber:  row.cast_number ?? null,
  }
}

// camelCase field → snake_case DB column
const DAY_FIELD_MAP = {
  dayNumber:   'day_number',
  date:        'date',
  location:    'location',
  unitBase:    'unit_base',
  generalCall: 'general_call',
  dayType:     'day_type',
  description: 'description',
  notes:       'notes',
  dayCategory: 'day_category',
  dayLabel:    'day_label',
}

const SCENE_FIELD_MAP = {
  sceneNumber:   'scene_number',
  intExt:        'int_ext',
  location:      'location',
  dayNight:      'day_night',
  description:   'description',
  pages:         'pages',
  castMemberIds: 'cast_member_ids',
  episodeNumber: 'episode_number',
}

const PRODUCTION_FIELD_MAP = {
  name:           'name',
  currency:       'currency',
  exchangeRates:  'exchange_rates',
  prepStartDate:  'prep_start_date',
  prepEndDate:    'prep_end_date',
  shootStartDate: 'shoot_start_date',
  shootEndDate:   'shoot_end_date',
  wrapStartDate:  'wrap_start_date',
  wrapEndDate:    'wrap_end_date',
  defaultDayType: 'default_day_type',
  workHours:      'work_hours',
  swdLunch:       'swd_lunch',
  cwdLunch:       'cwd_lunch',
  scwdLunch:      'scwd_lunch',
  format:         'format',
  episodeCount:   'episode_count',
}

function dbVal(value) {
  return value === '' ? null : value
}

// ─── Store hook ───────────────────────────────────────────────────────────────

export function useScheduleStore() {
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [productions, setProductions] = useState([])   // all productions (id + name)
  const [store,       setStore]       = useState({
    production: {
      id: null, name: '', currency: '£', exchangeRates: {},
      prepStartDate: '', prepEndDate: '',
      shootStartDate: '', shootEndDate: '',
      wrapStartDate:  '', wrapEndDate:  '',
      defaultDayType: 'SWD', workHours: 10,
      swdLunch: 60, cwdLunch: 0, scwdLunch: 30,
    },
    shootDays:   [],
    castMembers: [],
  })

  // ── Load data for the current production ─────────────────────────────────────

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return

    try {
      const { data: prod, error: prodErr } = await supabase
        .from('production').select('*').eq('id', prodId).single()
      if (prodErr) throw prodErr

      const { data: days, error: daysErr } = await supabase
        .from('shoot_days').select('*')
        .eq('production_id', prodId)
        .order('sort_order', { ascending: true })
      if (daysErr) throw daysErr

      const dayIds = (days ?? []).map(d => d.id)

      const { data: scenes, error: scenesErr } = dayIds.length
        ? await supabase.from('scenes').select('*')
            .in('day_id', dayIds)
            .order('sort_order', { ascending: true })
        : { data: [], error: null }
      if (scenesErr) throw scenesErr

      const { data: extras, error: extrasErr } = dayIds.length
        ? await supabase.from('day_extras').select('*')
            .in('day_id', dayIds)
            .order('sort_order', { ascending: true })
        : { data: [], error: null }
      if (extrasErr) throw extrasErr

      const { data: castRows, error: castErr } = await supabase
        .from('cast_members').select('*')
        .eq('production_id', prodId)
        .order('sort_order', { ascending: true })
      if (castErr) throw castErr

      const byDay = {}
      for (const sc of scenes ?? []) {
        if (!byDay[sc.day_id]) byDay[sc.day_id] = []
        byDay[sc.day_id].push(sc)
      }

      const extrasByDay = {}
      for (const ex of extras ?? []) {
        if (!extrasByDay[ex.day_id]) extrasByDay[ex.day_id] = []
        extrasByDay[ex.day_id].push(ex)
      }

      setStore({
        production:  mapProduction(prod),
        shootDays:   (days ?? []).map(d => mapDay(d, byDay[d.id] ?? [], extrasByDay[d.id] ?? [])),
        castMembers: (castRows ?? []).map(mapCastMember),
      })
      setError(null)
    } catch (err) {
      console.error('[store] loadAll:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Load the full productions list ──────────────────────────────────────────

  async function loadProductions() {
    try {
      let { data: prods, error: prodErr } = await supabase
        .from('production')
        .select('id, name')
        .order('id', { ascending: true })
      if (prodErr) throw prodErr

      if (!prods?.length) {
        const { data: created, error: createErr } = await supabase
          .from('production').insert({ name: 'Untitled Production' }).select().single()
        if (createErr) throw createErr
        prods = [created]
      }

      setProductions(prods.map(mapProductionSummary))

      // Determine which production is current
      const savedId = getCurrentProductionId()
      const valid   = prods.find(p => p.id === savedId)
      const activeId = valid ? savedId : prods[0].id
      setCurrentProductionId(activeId)

      await loadAll()
    } catch (err) {
      console.error('[store] loadProductions:', err)
      setError(err.message)
      setLoading(false)
    }
  }

  // ── Real-time + init ────────────────────────────────────────────────────────

  useEffect(() => {
    loadProductions()
    const unsub = onProductionChange(() => {
      setLoading(true)
      loadAll()
    })
    const channel = supabase
      .channel('fm_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shoot_days' },   loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scenes' },        loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'day_extras' },    loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cast_members' },  loadAll)
      .subscribe()
    return () => {
      unsub()
      supabase.removeChannel(channel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ────────────────────────────────────────────────────────────────

  function optimistic(updater) { setStore(s => updater(s)) }

  async function dbWrite(promise) {
    const { error: err } = await promise
    if (err) { console.error('[store] write error:', err); loadAll() }
  }

  // ── Production management ──────────────────────────────────────────────────

  function updateProduction(field, value) {
    optimistic(s => ({ ...s, production: { ...s.production, [field]: value } }))
    const prodId = getCurrentProductionId()
    const col = PRODUCTION_FIELD_MAP[field] ?? field
    dbWrite(supabase.from('production').update({ [col]: dbVal(value) }).eq('id', prodId))
    // Keep productions list name in sync
    if (field === 'name') {
      setProductions(ps => ps.map(p => p.id === prodId ? { ...p, name: value } : p))
    }
  }

  async function createProduction() {
    // Generate the ID client-side so we can fetch after the insert.
    // We can't use insert().select() because RETURNING runs before the
    // handle_new_production trigger fires, so RLS blocks the read-back.
    const newId = crypto.randomUUID()
    const { error: insertErr } = await supabase
      .from('production').insert({ id: newId, name: 'New Production' })
    if (insertErr) { console.error('[store] create production:', insertErr); return null }

    // By now the trigger has added us to production_members — safe to SELECT
    const { data, error: fetchErr } = await supabase
      .from('production').select('id, name').eq('id', newId).single()
    if (fetchErr) { console.error('[store] fetch new production:', fetchErr); return null }

    setProductions(ps => [...ps, mapProductionSummary(data)])
    setCurrentProductionId(newId)
    return newId
  }

  async function deleteProduction(id) {
    if (productions.length <= 1) return  // can't delete the last one
    const remaining = productions.filter(p => p.id !== id)
    if (getCurrentProductionId() === id) {
      setCurrentProductionId(remaining[0].id)
      // loadAll fires via listener
    }
    setProductions(remaining)
    await supabase.from('production').delete().eq('id', id)
  }

  function switchProduction(id) {
    if (id === getCurrentProductionId()) return
    setLoading(true)
    setCurrentProductionId(id)
    // loadAll fires via onProductionChange listener
  }

  // ── Shoot days ─────────────────────────────────────────────────────────────

  function addShootDay(category = 'main', initialDate = null) {
    const prodId = getCurrentProductionId()
    const days = store.shootDays
    const shootingDays = days.filter(d => !d.isNonShootDay && d.dayCategory === 'main')
    const lastDayNum   = shootingDays.length
      ? Math.max(...shootingDays.map(d => d.dayNumber ?? 0)) : 0

    function datePlusOne(dateStr) {
      const d = new Date(dateStr + 'T00:00:00')
      d.setDate(d.getDate() + 1)
      return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
    }

    let nextDate = null
    if (initialDate) {
      // Use the provided date as-is (e.g. beside-button → same date)
      nextDate = initialDate
    } else {
      // Header button → auto-pick the day after the last scheduled day
      const sorted = days.filter(d => d.date).sort((a, b) => (a.date < b.date ? -1 : 1))
      if (sorted.length) nextDate = datePlusOne(sorted[sorted.length - 1].date)
    }

    const newId        = crypto.randomUUID()
    const newSortOrder = days.length
    const newDayNumber = category === 'main' ? lastDayNum + 1 : null

    const newDay = {
      id: newId, dayNumber: newDayNumber, date: nextDate ?? '',
      location: '', locations: [''], unitBase: '', generalCall: '', dayType: '',
      isNonShootDay: false, description: '', notes: '',
      sortOrder: newSortOrder, scenes: [], dayCategory: category, dayLabel: '', extras: {},
    }
    optimistic(s => ({ ...s, shootDays: [...s.shootDays, newDay] }))

    dbWrite(
      supabase.from('shoot_days').insert({
        id: newId, production_id: prodId,
        day_number: newDayNumber, date: nextDate,
        locations: [], location: null,
        is_non_shoot_day: false, sort_order: newSortOrder,
        day_category: category,
      })
    )
    return newId
  }

  function addPrepDay(parentDay) {
    const prodId = getCurrentProductionId()
    const days = store.shootDays
    const newId = crypto.randomUUID()
    const newSortOrder = days.length

    // Prep days are ALWAYS non-shooting days
    const newDay = {
      id: newId, dayNumber: null, date: parentDay.date,
      location: '', locations: [''], unitBase: '', generalCall: '', dayType: '',
      isNonShootDay: true, description: '', notes: '',
      sortOrder: newSortOrder, scenes: [], dayCategory: 'prep', extras: {},
    }
    optimistic(s => ({ ...s, shootDays: [...s.shootDays, newDay] }))

    dbWrite(
      supabase.from('shoot_days').insert({
        id: newId, production_id: prodId,
        day_number: null, date: parentDay.date,
        locations: [], location: null,
        is_non_shoot_day: true, sort_order: newSortOrder,
        day_category: 'prep',
      })
    )
    return newId
  }

  function addSplinterDay(parentDay) {
    const prodId = getCurrentProductionId()
    const days = store.shootDays
    const newId = crypto.randomUUID()
    const newSortOrder = days.length

    const newDay = {
      id: newId, dayNumber: parentDay.dayNumber, date: parentDay.date,
      location: '', locations: [''], unitBase: '', generalCall: '', dayType: '',
      isNonShootDay: false, description: '', notes: '',
      sortOrder: newSortOrder, scenes: [], dayCategory: 'splinter', extras: {},
    }
    optimistic(s => ({ ...s, shootDays: [...s.shootDays, newDay] }))

    dbWrite(
      supabase.from('shoot_days').insert({
        id: newId, production_id: prodId,
        day_number: parentDay.dayNumber, date: parentDay.date,
        locations: [], location: null,
        is_non_shoot_day: false, sort_order: newSortOrder,
        day_category: 'splinter',
      })
    )
    return newId
  }

  function deleteShootDay(id) {
    optimistic(s => ({ ...s, shootDays: s.shootDays.filter(d => d.id !== id) }))
    dbWrite(supabase.from('shoot_days').delete().eq('id', id))
  }

  function updateShootDay(id, field, value) {
    let newDayNumber = null

    if (field === 'isNonShootDay' && value === false) {
      const maxNum = Math.max(
        0,
        ...store.shootDays
          .filter(x => x.id !== id && !x.isNonShootDay)
          .map(x => x.dayNumber ?? 0)
      )
      newDayNumber = maxNum + 1
    }

    // Changing to Main Unit: re-assign a day number
    if (field === 'dayCategory' && value === 'main') {
      const maxNum = Math.max(
        0,
        ...store.shootDays
          .filter(x => x.id !== id && x.dayCategory === 'main')
          .map(x => x.dayNumber ?? 0)
      )
      newDayNumber = maxNum + 1
    }

    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        if (d.id !== id) return d
        if (field === 'isNonShootDay') {
          return value === true
            ? { ...d, isNonShootDay: true,  dayNumber: null }
            : { ...d, isNonShootDay: false, dayNumber: newDayNumber }
        }
        if (field === 'dayCategory') {
          const isNonShoot = value === 'prep' || value === 'other' || value === 'rehearsal'
          return {
            ...d,
            dayCategory:   value,
            isNonShootDay: isNonShoot,
            dayNumber:     value === 'main' ? newDayNumber : null,
          }
        }
        // Keep derived location in sync when locations array changes
        if (field === 'locations') {
          return { ...d, locations: value, location: value[0] ?? '' }
        }
        return { ...d, [field]: value }
      }),
    }))

    let patch = {}
    if (field === 'isNonShootDay') {
      patch = value === true
        ? { is_non_shoot_day: true,  day_number: null }
        : { is_non_shoot_day: false, day_number: newDayNumber }
    } else if (field === 'dayCategory') {
      const isNonShoot = value === 'prep' || value === 'other' || value === 'rehearsal'
      patch = {
        day_category:    value,
        is_non_shoot_day: isNonShoot,
        day_number:      value === 'main' ? newDayNumber : null,
      }
    } else if (field === 'locations') {
      const nonEmpty = value.filter(Boolean)
      patch = { locations: nonEmpty, location: dbVal(nonEmpty[0] ?? '') }
    } else {
      const col = DAY_FIELD_MAP[field] ?? field
      patch = { [col]: dbVal(value) }
    }
    dbWrite(supabase.from('shoot_days').update(patch).eq('id', id))
  }

  async function _reorder(orderedDays) {
    const updated = orderedDays.map((d, i) => ({ ...d, sortOrder: i }))
    optimistic(s => ({ ...s, shootDays: updated }))
    await Promise.all(
      updated.map(d =>
        supabase.from('shoot_days').update({ sort_order: d.sortOrder }).eq('id', d.id)
      )
    )
  }

  function moveDayUp(id) {
    const days = [...store.shootDays]
    const idx = days.findIndex(d => d.id === id)
    if (idx <= 0) return
    ;[days[idx - 1], days[idx]] = [days[idx], days[idx - 1]]
    _reorder(days)
  }

  function moveDayDown(id) {
    const days = [...store.shootDays]
    const idx = days.findIndex(d => d.id === id)
    if (idx < 0 || idx >= days.length - 1) return
    ;[days[idx], days[idx + 1]] = [days[idx + 1], days[idx]]
    _reorder(days)
  }

  function reorderDays(fromId, toId) {
    const days = [...store.shootDays]
    const fromIdx = days.findIndex(d => d.id === fromId)
    const toIdx   = days.findIndex(d => d.id === toId)
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return
    const [moved] = days.splice(fromIdx, 1)
    days.splice(toIdx, 0, moved)
    _reorder(days)
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  function addScene(dayId) {
    const day = store.shootDays.find(d => d.id === dayId)
    const sortOrder = day?.scenes.length ?? 0
    const newId = crypto.randomUUID()
    const newScene = {
      id: newId, sceneNumber: '', intExt: 'INT', location: '',
      dayNight: 'DAY', description: '', pages: '', sortOrder,
      castMemberIds: [],
    }
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d =>
        d.id === dayId ? { ...d, scenes: [...d.scenes, newScene] } : d
      ),
    }))
    dbWrite(supabase.from('scenes').insert({ id: newId, day_id: dayId, sort_order: sortOrder }))
  }

  function deleteScene(dayId, sceneId) {
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d =>
        d.id === dayId
          ? { ...d, scenes: d.scenes.filter(sc => sc.id !== sceneId) }
          : d
      ),
    }))
    dbWrite(supabase.from('scenes').delete().eq('id', sceneId))
  }

  function updateScene(dayId, sceneId, field, value) {
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d =>
        d.id === dayId
          ? { ...d, scenes: d.scenes.map(sc => sc.id === sceneId ? { ...sc, [field]: value } : sc) }
          : d
      ),
    }))
    const col = SCENE_FIELD_MAP[field] ?? field
    dbWrite(supabase.from('scenes').update({ [col]: dbVal(value) }).eq('id', sceneId))
  }

  function updateSceneCast(dayId, sceneId, castMemberIds) {
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d =>
        d.id === dayId
          ? { ...d, scenes: d.scenes.map(sc => sc.id === sceneId ? { ...sc, castMemberIds } : sc) }
          : d
      ),
    }))
    dbWrite(supabase.from('scenes').update({ cast_member_ids: castMemberIds }).eq('id', sceneId))
  }

  // ── Day extras ─────────────────────────────────────────────────────────────

  function addDayExtra(dayId, category) {
    const newId = crypto.randomUUID()
    const day = store.shootDays.find(d => d.id === dayId)
    const existing = day?.extras?.[category] ?? []
    const sortOrder = existing.length

    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        if (d.id !== dayId) return d
        const prev = d.extras?.[category] ?? []
        return {
          ...d,
          extras: {
            ...d.extras,
            [category]: [...prev, { id: newId, description: '', sortOrder }],
          },
        }
      }),
    }))

    dbWrite(supabase.from('day_extras').insert({
      id: newId, day_id: dayId, category, description: '', sort_order: sortOrder,
    }))
  }

  function deleteDayExtra(dayId, extraId) {
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        if (d.id !== dayId) return d
        const newExtras = {}
        for (const [cat, items] of Object.entries(d.extras ?? {})) {
          const filtered = items.filter(e => e.id !== extraId)
          if (filtered.length > 0) newExtras[cat] = filtered
        }
        return { ...d, extras: newExtras }
      }),
    }))
    dbWrite(supabase.from('day_extras').delete().eq('id', extraId))
  }

  function updateDayExtra(dayId, extraId, description) {
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        if (d.id !== dayId) return d
        const newExtras = {}
        for (const [cat, items] of Object.entries(d.extras ?? {})) {
          newExtras[cat] = items.map(e => e.id === extraId ? { ...e, description } : e)
        }
        return { ...d, extras: newExtras }
      }),
    }))
    dbWrite(supabase.from('day_extras').update({ description }).eq('id', extraId))
  }

  // ── Cast members ───────────────────────────────────────────────────────────

  async function addCastMember() {
    const prodId = getCurrentProductionId()
    const newId = crypto.randomUUID()
    const sortOrder = store.castMembers.length
    // Auto-assign the next available cast number
    const maxNum = store.castMembers.reduce((m, c) => Math.max(m, c.castNumber ?? 0), 0)
    const castNumber = maxNum + 1
    const newMember = { id: newId, name: '', role: '', sortOrder, castNumber }
    optimistic(s => ({ ...s, castMembers: [...s.castMembers, newMember] }))
    dbWrite(supabase.from('cast_members').insert({
      id: newId, production_id: prodId, name: '', role: '', sort_order: sortOrder,
      cast_number: castNumber,
    }))
  }

  function deleteCastMember(id) {
    optimistic(s => ({ ...s, castMembers: s.castMembers.filter(c => c.id !== id) }))
    dbWrite(supabase.from('cast_members').delete().eq('id', id))
  }

  function updateCastMember(id, field, value) {
    optimistic(s => ({
      ...s,
      castMembers: s.castMembers.map(c => c.id === id ? { ...c, [field]: value } : c),
    }))
    const col = field === 'sortOrder'   ? 'sort_order'
              : field === 'castNumber'  ? 'cast_number'
              : field
    dbWrite(supabase.from('cast_members').update({ [col]: value }).eq('id', id))
  }

  async function reorderCastMembers(fromIdx, toIdx) {
    const members = [...store.castMembers]
    const [moved] = members.splice(fromIdx, 1)
    members.splice(toIdx, 0, moved)
    const updated = members.map((m, i) => ({ ...m, sortOrder: i }))
    optimistic(s => ({ ...s, castMembers: updated }))
    await Promise.all(
      updated.map(m =>
        supabase.from('cast_members').update({ sort_order: m.sortOrder }).eq('id', m.id)
      )
    )
  }

  async function importCastMembers(members) {
    const prodId = getCurrentProductionId()
    const maxSort = store.castMembers.length
    const rows = members.map((m, i) => ({
      id:            crypto.randomUUID(),
      production_id: prodId,
      name:          m.name,
      role:          m.role,
      cast_number:   m.castNumber ?? null,
      sort_order:    maxSort + i,
    }))
    const mapped = rows.map(r => ({
      id: r.id, name: r.name, role: r.role,
      castNumber: r.cast_number, sortOrder: r.sort_order,
    }))
    optimistic(s => ({ ...s, castMembers: [...s.castMembers, ...mapped] }))
    await supabase.from('cast_members').insert(rows)
    return rows.length
  }

  // ── Generate weekday shoot days ────────────────────────────────────────────

  async function generateShootDays(startDate, endDate) {
    if (!startDate || !endDate) return { count: 0 }
    const prodId = getCurrentProductionId()

    const weekdays = []
    const cur = new Date(startDate + 'T00:00:00')
    const end = new Date(endDate   + 'T00:00:00')
    while (cur <= end) {
      const dow = cur.getDay()
      if (dow !== 0 && dow !== 6) {
        weekdays.push([
          cur.getFullYear(),
          String(cur.getMonth() + 1).padStart(2, '0'),
          String(cur.getDate()).padStart(2, '0'),
        ].join('-'))
      }
      cur.setDate(cur.getDate() + 1)
    }

    const existingDates = new Set(
      store.shootDays.filter(d => d.dayCategory === 'main').map(d => d.date)
    )
    const newDates = weekdays.filter(d => !existingDates.has(d))
    if (newDates.length === 0) return { count: 0 }

    const shootingOnly = store.shootDays.filter(d => !d.isNonShootDay && d.dayCategory === 'main')
    const maxDayNum = shootingOnly.length ? Math.max(...shootingOnly.map(d => d.dayNumber ?? 0)) : 0
    const maxSort   = store.shootDays.length ? Math.max(...store.shootDays.map(d => d.sortOrder ?? 0)) : -1

    const newDays = newDates.map((date, i) => ({
      id:            crypto.randomUUID(),
      dayNumber:     maxDayNum + i + 1,
      date,
      location:      '', locations: [''], unitBase: '', generalCall: '',
      isNonShootDay: false, description: '', notes: '',
      sortOrder:     maxSort + i + 1,
      dayCategory:   'main',
      scenes:        [],
      extras:        {},
    }))

    optimistic(s => ({ ...s, shootDays: [...s.shootDays, ...newDays] }))

    const results = await Promise.all(
      newDays.map(day =>
        supabase.from('shoot_days').insert({
          id: day.id, production_id: prodId,
          day_number: day.dayNumber, date: day.date,
          locations: [], location: null,
          is_non_shoot_day: false, sort_order: day.sortOrder,
          day_category: 'main',
        })
      )
    )
    if (results.some(r => r.error)) { loadAll(); return { count: 0 } }

    markIdsNotified(newDays.map(d => d.id))
    return { count: newDays.length }
  }

  // ── Schedule move (cascade) ────────────────────────────────────────────────
  // dayMoves: [{ dayId, oldDate, newDate, isShunt }]
  // logChanges: [{ dayId, dayNumber, dayLabel, dayCategory, oldDate, newDate }]
  // userId: string

  async function executeScheduleMove({ dayMoves, logChanges, userId }) {
    const prodId = getCurrentProductionId()

    // 1. Optimistic update: patch shoot day dates in state
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        const move = dayMoves.find(m => m.dayId === d.id)
        if (!move) return d
        return { ...d, date: move.newDate }
      }),
    }))

    // 2. DB writes for shoot_days
    await Promise.all(
      dayMoves.map(m =>
        supabase.from('shoot_days').update({ date: m.newDate }).eq('id', m.dayId)
      )
    )

    // 3. Write audit log entries
    if (logChanges && logChanges.length > 0) {
      const rows = logChanges.map(lc => ({
        production_id: prodId,
        changed_by:    userId ?? null,
        day_id:        lc.dayId,
        day_number:    lc.dayNumber ?? null,
        day_label:     lc.dayLabel  ?? null,
        day_category:  lc.dayCategory ?? 'main',
        old_date:      lc.oldDate,
        new_date:      lc.newDate,
        change_type:   'date_move',
      }))
      const { error: auditErr } = await supabase.from('schedule_changes').insert(rows)
      if (auditErr) console.warn('[store] audit log write failed (non-fatal):', auditErr)
    }

    return { dayMoves }
  }

  // Resequence main unit day numbers 1, 2, 3… in chronological date order
  async function resequenceDayNumbers() {
    const mainDays = store.shootDays
      .filter(d => d.dayCategory === 'main' && d.date)
      .sort((a, b) => a.date.localeCompare(b.date))

    // Optimistic update
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        const idx = mainDays.findIndex(m => m.id === d.id)
        if (idx === -1) return d
        return { ...d, dayNumber: idx + 1 }
      }),
    }))

    // DB writes
    await Promise.all(
      mainDays.map((d, i) =>
        supabase.from('shoot_days').update({ day_number: i + 1 }).eq('id', d.id)
      )
    )
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    loading, error, store,
    productions, currentProductionId: getCurrentProductionId(),
    createProduction, deleteProduction, switchProduction,
    updateProduction,
    generateShootDays,
    addShootDay, deleteShootDay, updateShootDay,
    addPrepDay, addSplinterDay,
    moveDayUp, moveDayDown, reorderDays,
    executeScheduleMove, resequenceDayNumbers,
    addScene, deleteScene, updateScene,
    updateSceneCast,
    addDayExtra, deleteDayExtra, updateDayExtra,
    addCastMember, deleteCastMember, updateCastMember, reorderCastMembers, importCastMembers,
  }
}
