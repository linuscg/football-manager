import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

function mapItem(row) {
  return {
    id:        row.id,
    category:  row.category   ?? 'Other',
    name:      row.name       ?? '',
    amount:    row.amount     ?? 0,
    notes:     row.notes      ?? '',
    costCode:  row.cost_code  ?? '',
    sortOrder: row.sort_order ?? 0,
  }
}

export function useBudgetStore() {
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [items,   setItems]   = useState([])

  // Guards against the production-switch race: a slow loadAll for the previous
  // production must never land its rows after a newer load began.
  const loadGenRef = useRef(0)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const gen = ++loadGenRef.current

    try {
      const { data, error: err } = await supabase
        .from('budget_items')
        .select('*')
        .eq('production_id', prodId)
        .order('sort_order', { ascending: true })
      if (err) throw err
      // A newer load (production switch) started while we were fetching —
      // discard this result instead of overwriting the newer production.
      if (gen !== loadGenRef.current) return
      setItems((data ?? []).map(mapItem))
      setError(null)
    } catch (err) {
      if (gen !== loadGenRef.current) return
      console.error('[budget store] loadAll:', err)
      setError(err.message)
    } finally {
      if (gen === loadGenRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => {
      setLoading(true)
      setItems([])
      loadAll()
    })
    // Unique topic per hook instance — duplicate joins on a fixed topic
    // conflict in supabase-js when several components mount the same hook.
    const channel = supabase
      .channel(`budget_changes_${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_items' }, loadAll)
      .subscribe()
    return () => {
      unsub()
      supabase.removeChannel(channel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function addItem() {
    const prodId    = getCurrentProductionId()
    const newId     = crypto.randomUUID()
    const sortOrder = items.length
    const newItem   = { id: newId, category: 'Other', name: 'New item', amount: 0, notes: '', sortOrder }
    setItems(is => [...is, newItem])
    supabase.from('budget_items').insert({
      id: newId, production_id: prodId,
      category: 'Other', name: 'New item', amount: 0, sort_order: sortOrder,
    }).then(({ error: err }) => { if (err) { console.error('[budget store] insert:', err); loadAll() } })
    return newId
  }

  function deleteItem(id) {
    setItems(is => is.filter(i => i.id !== id))
    supabase.from('budget_items').delete().eq('id', id)
      .then(({ error: err }) => { if (err) loadAll() })
  }

  function updateItem(id, field, value) {
    // field names are snake_case DB columns; map back to the camelCase used in
    // the mapped object for optimistic local state (e.g. cost_code → costCode).
    const localField = field === 'cost_code' ? 'costCode'
      : field === 'sort_order' ? 'sortOrder'
      : field
    setItems(is => is.map(i => i.id === id ? { ...i, [localField]: value } : i))
    supabase.from('budget_items').update({ [field]: value }).eq('id', id)
      .then(({ error: err }) => { if (err) loadAll() })
  }

  return { loading, error, items, addItem, deleteItem, updateItem }
}
