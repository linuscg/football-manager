import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapSetting(row) {
  return {
    id:           row.id,
    dayId:        row.day_id,
    department:   row.department    ?? '',
    preCallMins:  row.pre_call_mins ?? 0,
    derigMins:    row.derig_mins    ?? 0,
  }
}

function mapOverride(row) {
  return {
    id:            row.id,
    dayId:         row.day_id,
    memberId:      row.member_id,
    callTime:      row.call_time      ?? null,
    wrapTime:      row.wrap_time      ?? null,
    lunch:         row.lunch          ?? true,
    scenechronize: row.scenechronize  ?? false,
  }
}

function mapDaySetting(row) {
  return {
    id:            row.id,
    dayId:         row.day_id,
    lunchIncluded: row.lunch_included ?? true,
    scenechronize: row.scenechronize  ?? false,
  }
}

// ─── Store hook ───────────────────────────────────────────────────────────────

export function useBackpageStore() {
  const [deptSettings,    setDeptSettings]    = useState([])
  const [memberOverrides, setMemberOverrides] = useState([])
  const [daySettings,     setDaySettings]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    try {
      const [settingsRes, overridesRes, daySettingsRes] = await Promise.all([
        supabase.from('backpage_dept_settings')    .select('*').eq('production_id', prodId),
        supabase.from('backpage_member_overrides') .select('*').eq('production_id', prodId),
        supabase.from('backpage_day_settings')     .select('*').eq('production_id', prodId),
      ])
      if (settingsRes.error)    throw settingsRes.error
      if (overridesRes.error)   throw overridesRes.error
      if (daySettingsRes.error) throw daySettingsRes.error
      setDeptSettings((settingsRes.data    ?? []).map(mapSetting))
      setMemberOverrides((overridesRes.data ?? []).map(mapOverride))
      setDaySettings((daySettingsRes.data   ?? []).map(mapDaySetting))
      setError(null)
    } catch (err) {
      console.error('[backpage store] loadAll:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => {
      setLoading(true)
      setDeptSettings([])
      setMemberOverrides([])
      setDaySettings([])
      loadAll()
    })
    const ch1 = supabase
      .channel('backpage_dept_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'backpage_dept_settings' }, loadAll)
      .subscribe()
    const ch2 = supabase
      .channel('backpage_override_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'backpage_member_overrides' }, loadAll)
      .subscribe()
    const ch3 = supabase
      .channel('backpage_day_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'backpage_day_settings' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dept settings ─────────────────────────────────────────────────────────

  function getDeptSetting(dayId, department) {
    return deptSettings.find(s => s.dayId === dayId && s.department === department)
      ?? { preCallMins: 0, derigMins: 0 }
  }

  async function upsertDeptSetting(dayId, department, field, value) {
    const prodId   = getCurrentProductionId()
    const existing = deptSettings.find(s => s.dayId === dayId && s.department === department)

    if (existing) {
      setDeptSettings(ss => ss.map(s => s.id === existing.id ? { ...s, [field]: value } : s))
      const col = field === 'preCallMins' ? 'pre_call_mins' : 'derig_mins'
      const { error: err } = await supabase
        .from('backpage_dept_settings').update({ [col]: value }).eq('id', existing.id)
      if (err) { console.error('[backpage store] update dept:', err); loadAll() }
    } else {
      const newId       = crypto.randomUUID()
      const preCallMins = field === 'preCallMins' ? value : 0
      const derigMins   = field === 'derigMins'   ? value : 0
      const newSetting  = { id: newId, dayId, department, preCallMins, derigMins }
      setDeptSettings(ss => [...ss, newSetting])
      const { error: err } = await supabase
        .from('backpage_dept_settings')
        .insert({ id: newId, production_id: prodId, day_id: dayId, department, pre_call_mins: preCallMins, derig_mins: derigMins })
      if (err) { console.error('[backpage store] insert dept:', err); loadAll() }
    }
  }

  // ── Day settings (lunch toggle, scenechronize) ────────────────────────────

  function getDaySetting(dayId) {
    return daySettings.find(s => s.dayId === dayId)
      ?? { lunchIncluded: true, scenechronize: false }
  }

  async function upsertDaySetting(dayId, field, value) {
    const prodId   = getCurrentProductionId()
    const existing = daySettings.find(s => s.dayId === dayId)

    if (existing) {
      setDaySettings(ss => ss.map(s => s.id === existing.id ? { ...s, [field]: value } : s))
      const col = field === 'lunchIncluded' ? 'lunch_included' : 'scenechronize'
      const { error: err } = await supabase
        .from('backpage_day_settings').update({ [col]: value }).eq('id', existing.id)
      if (err) { console.error('[backpage store] update day setting:', err); loadAll() }
    } else {
      const newId        = crypto.randomUUID()
      const lunchIncluded = field === 'lunchIncluded' ? value : true
      const scenechronize = field === 'scenechronize'  ? value : false
      setDaySettings(ss => [...ss, { id: newId, dayId, lunchIncluded, scenechronize }])
      const { error: err } = await supabase
        .from('backpage_day_settings')
        .insert({ id: newId, production_id: prodId, day_id: dayId, lunch_included: lunchIncluded, scenechronize })
      if (err) { console.error('[backpage store] insert day setting:', err); loadAll() }
    }
  }

  // ── Member overrides ──────────────────────────────────────────────────────

  function getMemberOverride(dayId, memberId) {
    return memberOverrides.find(o => o.dayId === dayId && o.memberId === memberId) ?? null
  }

  // Column name map for all override fields
  const OVERRIDE_COL = {
    callTime:      'call_time',
    wrapTime:      'wrap_time',
    lunch:         'lunch',
    scenechronize: 'scenechronize',
  }

  // A row is "all defaults" if it carries no meaningful data worth storing
  function isDefaultOverride(o) {
    return o.callTime === null && o.wrapTime === null &&
           (o.lunch === true || o.lunch == null) &&
           !o.scenechronize
  }

  async function upsertMemberOverride(dayId, memberId, field, value) {
    const prodId   = getCurrentProductionId()
    const existing = memberOverrides.find(o => o.dayId === dayId && o.memberId === memberId)

    // Normalise: empty strings on text fields become null
    const norm = (field === 'callTime' || field === 'wrapTime')
      ? (value?.trim() || null)
      : value

    if (existing) {
      const updated = { ...existing, [field]: norm }
      if (isDefaultOverride(updated)) {
        // Row back to all-defaults — clean it up
        setMemberOverrides(oo => oo.filter(o => o.id !== existing.id))
        const { error: err } = await supabase
          .from('backpage_member_overrides').delete().eq('id', existing.id)
        if (err) { console.error('[backpage store] delete override:', err); loadAll() }
      } else {
        setMemberOverrides(oo => oo.map(o => o.id === existing.id ? updated : o))
        const { error: err } = await supabase
          .from('backpage_member_overrides')
          .update({ [OVERRIDE_COL[field]]: norm })
          .eq('id', existing.id)
        if (err) { console.error('[backpage store] update override:', err); loadAll() }
      }
    } else {
      // Don't create a row for a no-op (e.g. clearing an already-default value)
      const candidate = {
        callTime: null, wrapTime: null, lunch: true, scenechronize: false,
        [field]: norm,
      }
      if (isDefaultOverride(candidate)) return

      const newId = crypto.randomUUID()
      const row   = { id: newId, dayId, memberId, ...candidate }
      setMemberOverrides(oo => [...oo, row])
      const { error: err } = await supabase
        .from('backpage_member_overrides')
        .insert({
          id: newId, production_id: prodId, day_id: dayId, member_id: memberId,
          call_time:     candidate.callTime,
          wrap_time:     candidate.wrapTime,
          lunch:         candidate.lunch,
          scenechronize: candidate.scenechronize,
        })
      if (err) { console.error('[backpage store] insert override:', err); loadAll() }
    }
  }

  return {
    deptSettings, memberOverrides, daySettings, loading, error,
    getDeptSetting,    upsertDeptSetting,
    getDaySetting,     upsertDaySetting,
    getMemberOverride, upsertMemberOverride,
  }
}
