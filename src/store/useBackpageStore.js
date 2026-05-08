import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapSetting(row) {
  return {
    id:           row.id,
    dayId:        row.day_id,
    department:   row.department    ?? '',
    preCallMins:  row.pre_call_mins ?? 0,
    derigMins:    row.derig_mins    ?? 0,
  }
}

// ─── Store hook ───────────────────────────────────────────────────────────────

export function useBackpageStore() {
  const [deptSettings, setDeptSettings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    try {
      const { data, error: err } = await supabase
        .from('backpage_dept_settings')
        .select('*')
        .eq('production_id', prodId)
      if (err) throw err
      setDeptSettings((data ?? []).map(mapSetting))
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
      loadAll()
    })
    const channel = supabase
      .channel('backpage_dept_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'backpage_dept_settings' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Get settings for a specific day + department ──────────────────────────

  function getDeptSetting(dayId, department) {
    return deptSettings.find(s => s.dayId === dayId && s.department === department)
      ?? { preCallMins: 0, derigMins: 0 }
  }

  // ── Upsert (create or update) a dept setting ──────────────────────────────

  async function upsertDeptSetting(dayId, department, field, value) {
    const prodId = getCurrentProductionId()
    const existing = deptSettings.find(s => s.dayId === dayId && s.department === department)

    if (existing) {
      // Optimistic update
      setDeptSettings(ss => ss.map(s =>
        s.id === existing.id ? { ...s, [field]: value } : s
      ))
      const col = field === 'preCallMins' ? 'pre_call_mins' : 'derig_mins'
      const { error: err } = await supabase
        .from('backpage_dept_settings')
        .update({ [col]: value })
        .eq('id', existing.id)
      if (err) { console.error('[backpage store] update:', err); loadAll() }
    } else {
      // Insert new row
      const newId       = crypto.randomUUID()
      const preCallMins = field === 'preCallMins' ? value : 0
      const derigMins   = field === 'derigMins'   ? value : 0
      const newSetting  = { id: newId, dayId, department, preCallMins, derigMins }
      setDeptSettings(ss => [...ss, newSetting])
      const { error: err } = await supabase
        .from('backpage_dept_settings')
        .insert({
          id: newId, production_id: prodId,
          day_id: dayId, department,
          pre_call_mins: preCallMins,
          derig_mins:    derigMins,
        })
      if (err) { console.error('[backpage store] insert:', err); loadAll() }
    }
  }

  return {
    deptSettings, loading, error,
    getDeptSetting,
    upsertDeptSetting,
  }
}
