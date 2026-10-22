import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

// Per-person per-date overtime, used for FLAT (prep/wrap) timesheet days.
// Keyed `${resourceId}:${date}` → hours (numeric).

export function useTimesheetOtStore() {
  const [otMap, setOtMap] = useState({})

  // Guards against the production-switch race: a slow loadAll for the previous
  // production must never land its rows after a newer load began.
  const loadGenRef = useRef(0)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const gen = ++loadGenRef.current
    // OT rows grow as crew × dates and can exceed Supabase's 1,000-row
    // per-request cap — fetch in pages until exhausted.
    const rows = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('timesheet_ot')
        .select('*')
        .eq('production_id', prodId)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) { console.error('[timesheet ot] load:', error); return }
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
    const map = {}
    for (const row of rows) {
      map[`${row.resource_id}:${row.date}`] = Number(row.ot_hours) || 0
    }
    // A newer load (production switch) started while we were fetching —
    // discard this result instead of overwriting the newer production.
    if (gen !== loadGenRef.current) return
    setOtMap(map)
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setOtMap({}); loadAll() })
    // Unique topic per hook instance — duplicate joins on a fixed topic
    // conflict in supabase-js when several components mount the same hook.
    const channel = supabase
      .channel(`timesheet_ot_changes_${crypto.randomUUID()}`)
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
