import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ─── Row mappers (snake_case DB → camelCase React) ────────────────────────────

function mapDay(row, scenes = []) {
  return {
    id: row.id,
    dayNumber: row.day_number ?? null,
    date: row.date ?? '',
    location: row.location ?? '',
    unitBase: row.unit_base ?? '',
    generalCall: row.general_call ?? '',
    isNonShootDay: row.is_non_shoot_day ?? false,
    description: row.description ?? '',
    notes: row.notes ?? '',
    sortOrder: row.sort_order ?? 0,
    scenes: scenes
      .map(mapScene)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }
}

function mapScene(row) {
  return {
    id: row.id,
    sceneNumber: row.scene_number ?? '',
    intExt: row.int_ext ?? 'INT',
    location: row.location ?? '',
    dayNight: row.day_night ?? 'DAY',
    description: row.description ?? '',
    pages: row.pages ?? '',
    sortOrder: row.sort_order ?? 0,
  }
}

// camelCase field → snake_case DB column
const DAY_FIELD_MAP = {
  dayNumber:   'day_number',
  date:        'date',
  location:    'location',
  unitBase:    'unit_base',
  generalCall: 'general_call',
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

// Treat empty strings as null for date/time DB columns
function dbVal(value) {
  return value === '' ? null : value
}

// Module-level cache so the production id survives re-renders
let _productionId = null

// ─── Store hook ───────────────────────────────────────────────────────────────

export function useScheduleStore() {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [store, setStore]     = useState({
    production: { name: '', prepStartDate: '' },
    shootDays: [],
  })

  // ── Load all data from Supabase ──────────────────────────────────────────

  async function loadAll() {
    try {
      // Get the first production row (create one if the table is empty)
      let { data: prods, error: prodErr } = await supabase
        .from('production')
        .select('*')
        .limit(1)
      if (prodErr) throw prodErr

      if (!prods.length) {
        const { data: created, error: createErr } = await supabase
          .from('production')
          .insert({ name: 'Untitled Production' })
          .select()
          .single()
        if (createErr) throw createErr
        prods = [created]
      }

      const prod = prods[0]
      _productionId = prod.id

      // Shoot days ordered by sort_order
      const { data: days, error: daysErr } = await supabase
        .from('shoot_days')
        .select('*')
        .eq('production_id', _productionId)
        .order('sort_order', { ascending: true })
      if (daysErr) throw daysErr

      // All scenes for those days
      const dayIds = (days ?? []).map(d => d.id)
      const { data: scenes, error: scenesErr } = dayIds.length
        ? await supabase
            .from('scenes')
            .select('*')
            .in('day_id', dayIds)
            .order('sort_order', { ascending: true })
        : { data: [], error: null }
      if (scenesErr) throw scenesErr

      // Group scenes by day_id
      const byDay = {}
      for (const sc of scenes ?? []) {
        if (!byDay[sc.day_id]) byDay[sc.day_id] = []
        byDay[sc.day_id].push(sc)
      }

      setStore({
        production: {
          name: prod.name ?? 'Untitled Production',
          prepStartDate: prod.prep_start_date ?? '',
        },
        shootDays: (days ?? []).map(d => mapDay(d, byDay[d.id] ?? [])),
      })
      setError(null)
    } catch (err) {
      console.error('[store] loadAll:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Real-time: reload whenever any other client changes the DB ───────────

  useEffect(() => {
    loadAll()

    const channel = supabase
      .channel('fm_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shoot_days' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scenes' },     loadAll)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────────────────

  function optimistic(updater) {
    setStore(s => updater(s))
  }

  async function dbWrite(promise) {
    const { error: err } = await promise
    if (err) {
      console.error('[store] write error:', err)
      loadAll() // revert by reloading
    }
  }

  // ── Production ───────────────────────────────────────────────────────────

  function setProductionName(name) {
    optimistic(s => ({ ...s, production: { ...s.production, name } }))
    dbWrite(supabase.from('production').update({ name }).eq('id', _productionId))
  }

  function setPrepStartDate(prepStartDate) {
    optimistic(s => ({ ...s, production: { ...s.production, prepStartDate } }))
    dbWrite(
      supabase
        .from('production')
        .update({ prep_start_date: dbVal(prepStartDate) })
        .eq('id', _productionId)
    )
  }

  // ── Shoot days ───────────────────────────────────────────────────────────

  function addShootDay() {
    const days = store.shootDays

    // Only shooting days get day numbers
    const shootingDays = days.filter(d => !d.isNonShootDay)
    const lastDayNum = shootingDays.length
      ? Math.max(...shootingDays.map(d => d.dayNumber ?? 0))
      : 0

    // Auto-advance date using local arithmetic (no UTC conversion)
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

    const newId       = crypto.randomUUID()
    const newSortOrder = days.length
    const newDayNumber = lastDayNum + 1

    // Optimistic insert
    const newDay = {
      id: newId, dayNumber: newDayNumber, date: nextDate ?? '',
      location: '', unitBase: '', generalCall: '',
      isNonShootDay: false, description: '', notes: '', sortOrder: newSortOrder, scenes: [],
    }
    optimistic(s => ({ ...s, shootDays: [...s.shootDays, newDay] }))

    // Persist
    dbWrite(
      supabase.from('shoot_days').insert({
        id:              newId,
        production_id:   _productionId,
        day_number:      newDayNumber,
        date:            nextDate,
        is_non_shoot_day: false,
        sort_order:      newSortOrder,
      })
    )

    return newId
  }

  function deleteShootDay(id) {
    optimistic(s => ({ ...s, shootDays: s.shootDays.filter(d => d.id !== id) }))
    dbWrite(supabase.from('shoot_days').delete().eq('id', id))
  }

  function updateShootDay(id, field, value) {
    // Compute new day-number before the optimistic update mutates the state
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
            ? { ...d, isNonShootDay: true, dayNumber: null }
            : { ...d, isNonShootDay: false, dayNumber: newDayNumber }
        }
        return { ...d, [field]: value }
      }),
    }))

    // Build DB update
    let patch = {}
    if (field === 'isNonShootDay') {
      patch = value === true
        ? { is_non_shoot_day: true, day_number: null }
        : { is_non_shoot_day: false, day_number: newDayNumber }
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

  // ── Scenes ───────────────────────────────────────────────────────────────

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

    dbWrite(
      supabase.from('scenes').insert({ id: newId, day_id: dayId, sort_order: sortOrder })
    )
  }

  function deleteScene(dayId, sceneId) {
    optimistic(s => ({
      ...s,
      shootDays: s.shootDays.map(d =>
        d.id === dayId ? { ...d, scenes: d.scenes.filter(sc => sc.id !== sceneId) } : d
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

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    loading,
    error,
    store,
    setProductionName,
    setPrepStartDate,
    addShootDay,
    deleteShootDay,
    updateShootDay,
    moveDayUp,
    moveDayDown,
    reorderDays,
    addScene,
    deleteScene,
    updateScene,
  }
}
