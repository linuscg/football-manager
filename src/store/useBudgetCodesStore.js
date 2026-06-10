import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

function mapCode(row) {
  return {
    id:          row.id,
    code:        row.code        ?? '',
    description: row.description ?? '',
    sortOrder:   row.sort_order  ?? 0,
  }
}

export function useBudgetCodesStore() {
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [codes,   setCodes]   = useState([])

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return

    try {
      const { data, error: err } = await supabase
        .from('budget_codes')
        .select('*')
        .eq('production_id', prodId)
        .order('sort_order', { ascending: true })
      if (err) throw err
      setCodes((data ?? []).map(mapCode))
      setError(null)
    } catch (err) {
      console.error('[budget codes store] loadAll:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => {
      setLoading(true)
      setCodes([])
      loadAll()
    })
    const channel = supabase
      .channel('budget_codes_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_codes' }, loadAll)
      .subscribe()
    return () => {
      unsub()
      supabase.removeChannel(channel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function addCode() {
    const prodId    = getCurrentProductionId()
    const newId     = crypto.randomUUID()
    const sortOrder = codes.length
    const newCode   = { id: newId, code: '', description: '', sortOrder }
    setCodes(cs => [...cs, newCode])
    supabase.from('budget_codes').insert({
      id: newId, production_id: prodId,
      code: '', description: '', sort_order: sortOrder,
    }).then(({ error: err }) => { if (err) { console.error('[budget codes store] insert:', err); loadAll() } })
    return newId
  }

  function deleteCode(id) {
    setCodes(cs => cs.filter(c => c.id !== id))
    supabase.from('budget_codes').delete().eq('id', id)
      .then(({ error: err }) => { if (err) loadAll() })
  }

  function updateCode(id, field, value) {
    setCodes(cs => cs.map(c => c.id === id ? { ...c, [field]: value } : c))
    const col = field === 'sortOrder' ? 'sort_order' : field
    supabase.from('budget_codes').update({ [col]: value }).eq('id', id)
      .then(({ error: err }) => { if (err) loadAll() })
  }

  return { loading, error, codes, addCode, updateCode, deleteCode }
}
