import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

// Per-person per-date overtime, used for FLAT (prep/wrap) timesheet days.
// Keyed `${resourceId}:${date}` → hours (numeric).

export function useTimesheetOtStore() {
  const [otMap, setOtMap] = useState({})

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const { data, error } = await supabase
      .from('timesheet_ot')
      .select('*')
      .eq('production_id', prodId)
    if (error) { console.error('[timesheet ot] load:', error); return }
    const map = {}
    for (const row of data ?? []) {
      map[`${row.resource_id}:${row.date}`] = Number(row.ot_hours) || 0
    }
    setOtMap(map)
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setOtMap({}); loadAll() })
    const channel = supabase
      .channel('timesheet_ot_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timesheet_ot' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function getOt(resourceId, date) {
    return otMap[`${resourceId}:${date}`] ?? 0
  }

  async function setOt(resourceId, date, hours) {
    const prodId = getCurrentProductionId()
    const num = parseFloat(hours)
    const key = `${resourceId}:${date}`

    if (!num || num <= 0) {
      // Clearing OT removes the row entirely.
      setOtMap(m => { const n = { ...m }; delete n[key]; return n })
      const { error } = await supabase
        .from('timesheet_ot')
        .delete()
        .eq('production_id', prodId)
        .eq('resource_id', resourceId)
        .eq('date', date)
      if (error) { console.error('[timesheet ot] clear:', error); loadAll() }
      return
    }

    setOtMap(m => ({ ...m, [key]: num }))
    const { error } = await supabase
      .from('timesheet_ot')
      .upsert(
        { production_id: prodId, resource_id: resourceId, date, ot_hours: num },
        { onConflict: 'production_id,resource_id,date' }
      )
    if (error) { console.error('[timesheet ot] upsert:', error); loadAll() }
  }

  return { getOt, setOt }
}
