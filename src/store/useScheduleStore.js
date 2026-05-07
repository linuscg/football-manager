import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { markIdsNotified } from '../lib/ganttNotified'
import {
  getCurrentProductionId,
  setCurrentProductionId,
  onProductionChange,
} from '../lib/productionContext'

// ─── Row mappers (snake_case DB → camelCase React) ────────────────────────────

function mapDay(row, scenes = []) {
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
    scenes:        scenes.map(mapScene).sort((a, b) => a.sortOrder - b.sortOrder),
  }
}

function mapScene(row) {
  return {
    id:          row.id,
    sceneNumber: row.scene_number ?? '',
    intExt:      row.int_ext      ?? 'INT',
    location:    row.location     ?? '',
    dayNight:    row.day_night    ?? 'DAY',
    description: row.description  ?? '',
    pages:       row.pages        ?? '',
    sortOrder:   row.sort_order   ?? 0,
  }
}

function mapProduction(row) {
  return {
    id:             row.id,
    name:           row.name            ?? 'Untitled Production',
    currency:       row.currency        ?? '£',
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
  }
}

function mapProductionSummary(row) {
  return { id: row.id, name: row.name ?? 'Untitled Production' }
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
}

const SCENE_FIELD_MAP = {
  sceneNumber: 'scene_number',
  intExt:      'int_ext',
  location:    'location',
  dayNight:    'day_night',
  description: 'description',
  pages:       'pages',
}

const PRODUCTION_FIELD_MAP = {
  name:           'name',
  currency:       'currency',
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
      id: null, name: '', currency: '£',
      prepStartDate: '', prepEndDate: '',
      shootStartDate: '', shootEndDate: '',
      wrapStartDate:  '', wrapEndDate:  '',
      defaultDayType: 'SWD', workHours: 10,
      swdLunch: 60, cwdLunch: 0, scwdLunch: 30,
    },
    shootDays: [],
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

      const byDay = {}
      for (const sc of scenes ?? []) {
        if (!byDay[sc.day_id]) byDay[sc.day_id] = []
        byDay[sc.day_id].push(sc)
      }

      setStore({
        production: mapProduction(prod),
        shootDays:  (days ?? []).map(d => mapDay(d, byDay[d.id] ?? [])),
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shoot_days' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scenes' },     loadAll)
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
    const { data, error: err } = await supabase
      .from('production').insert({ name: 'New Production' }).select().single()
    if (err) { console.error('[store] create production:', err); return }
    setProductions(ps => [...ps, mapProductionSummary(data)])
    setCurrentProductionId(data.id)
    // loadAll fires via onProductionChange listener
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

  function addShootDay() {
    const prodId = getCurrentProductionId()
    const days = store.shootDays
    const shootingDays = days.filter(d => !d.isNonShootDay)
    const lastDayNum   = shootingDays.length
      ? Math.max(...shootingDays.map(d => d.dayNumber ?? 0)) : 0

    const sorted = days.filter(d => d.date).sort((a, b) => (a.date < b.date ? -1 : 1))
    let nextDate = null
    if (sorted.length) {
      const last = new Date(sorted[sorted.length - 1].date + 'T00:00:00')
      last.setDate(last.getDate() + 1)
      const y = last.getFullYear()
      const m = String(last.getMonth() + 1).padStart(2, '0')
      const d = String(last.getDate()).padStart(2, '0')
      nextDate = `${y}-${m}-${d}`
    }

    const newId        = crypto.randomUUID()
    const newSortOrder = days.length
    const newDayNumber = lastDayNum + 1

    const newDay = {
      id: newId, dayNumber: newDayNumber, date: nextDate ?? '',
      location: '', locations: [''], unitBase: '', generalCall: '', dayType: '',
      isNonShootDay: false, description: '', notes: '',
      sortOrder: newSortOrder, scenes: [],
    }
    optimistic(s => ({ ...s, shootDays: [...s.shootDays, newDay] }))

    dbWrite(
      supabase.from('shoot_days').insert({
        id: newId, production_id: prodId,
        day_number: newDayNumber, date: nextDate,
        locations: [], location: null,
        is_non_shoot_day: false, sort_order: newSortOrder,
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

    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        if (d.id !== id) return d
        if (field === 'isNonShootDay') {
          return value === true
            ? { ...d, isNonShootDay: true,  dayNumber: null }
            : { ...d, isNonShootDay: false, dayNumber: newDayNumber }
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

    const existingDates = new Set(store.shootDays.map(d => d.date))
    const newDates = weekdays.filter(d => !existingDates.has(d))
    if (newDates.length === 0) return { count: 0 }

    const shootingOnly = store.shootDays.filter(d => !d.isNonShootDay)
    const maxDayNum = shootingOnly.length ? Math.max(...shootingOnly.map(d => d.dayNumber ?? 0)) : 0
    const maxSort   = store.shootDays.length ? Math.max(...store.shootDays.map(d => d.sortOrder ?? 0)) : -1

    const newDays = newDates.map((date, i) => ({
      id:            crypto.randomUUID(),
      dayNumber:     maxDayNum + i + 1,
      date,
      location:      '', locations: [''], unitBase: '', generalCall: '',
      isNonShootDay: false, description: '', notes: '',
      sortOrder:     maxSort + i + 1,
      scenes:        [],
    }))

    optimistic(s => ({ ...s, shootDays: [...s.shootDays, ...newDays] }))

    const results = await Promise.all(
      newDays.map(day =>
        supabase.from('shoot_days').insert({
          id: day.id, production_id: prodId,
          day_number: day.dayNumber, date: day.date,
          locations: [], location: null,
          is_non_shoot_day: false, sort_order: day.sortOrder,
        })
      )
    )
    if (results.some(r => r.error)) { loadAll(); return { count: 0 } }

    markIdsNotified(newDays.map(d => d.id))
    return { count: newDays.length }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    loading, error, store,
    productions, currentProductionId: getCurrentProductionId(),
    createProduction, deleteProduction, switchProduction,
    updateProduction,
    generateShootDays,
    addShootDay, deleteShootDay, updateShootDay,
    moveDayUp, moveDayDown, reorderDays,
    addScene, deleteScene, updateScene,
  }
}
