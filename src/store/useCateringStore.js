import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

function mapRecord(row) {
  return {
    id:          row.id,
    dayId:       row.day_id,
    personId:    row.person_id   ?? null,
    personName:  row.person_name ?? '',
    personType:  row.person_type ?? 'fulltime',
    collected:   row.collected   ?? false,
    collectedAt: row.collected_at ?? null,
    note:        row.note        ?? '',
  }
}

export function useCateringStore() {
  const [records,  setRecords]  = useState([])
  const [loading,  setLoading]  = useState(true)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const { data, error } = await supabase
      .from('catering_collections')
      .select('*')
      .eq('production_id', prodId)
    if (error) { console.error('[catering] load:', error); return }
    setRecords((data ?? []).map(mapRecord))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setRecords([]); loadAll() })
    const channel = supabase
      .channel('catering_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catering_collections' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lookup ─────────────────────────────────────────────────────────────────

  function getRecord(dayId, personId) {
    return records.find(r => r.dayId === dayId && r.personId === personId) ?? null
  }

  function getAdhoc(dayId) {
    return records.filter(r => r.dayId === dayId && r.personType === 'adhoc')
  }

  // ── Upsert helpers ─────────────────────────────────────────────────────────

  async function _upsertKnown(dayId, personId, personName, personType, patch) {
    const prodId   = getCurrentProductionId()
    const existing = getRecord(dayId, personId)
    if (existing) {
      setRecords(rs => rs.map(r => r.id === existing.id ? { ...r, ...patch } : r))
      const { error } = await supabase.from('catering_collections').update(patch).eq('id', existing.id)
      if (error) { console.error('[catering] update:', error); loadAll() }
    } else {
      const newId  = crypto.randomUUID()
      const newRec = {
        id: newId, production_id: prodId, day_id: dayId,
        person_id: personId, person_name: personName, person_type: personType,
        collected: false, collected_at: null, note: '',
        ...patch,
      }
      setRecords(rs => [...rs, mapRecord(newRec)])
      const { error } = await supabase.from('catering_collections').insert(newRec)
      if (error) { console.error('[catering] insert:', error); loadAll() }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function setCollected(dayId, personId, personName, personType, collected) {
    const collectedAt = collected ? new Date().toISOString() : null
    _upsertKnown(dayId, personId, personName, personType, { collected, collected_at: collectedAt })
  }

  function setNote(dayId, personId, personName, personType, note) {
    _upsertKnown(dayId, personId, personName, personType, { note })
  }

  async function addAdhoc(dayId, name) {
    const prodId = getCurrentProductionId()
    const newId  = crypto.randomUUID()
    const newRec = {
      id: newId, production_id: prodId, day_id: dayId,
      person_id: null, person_name: name, person_type: 'adhoc',
      collected: false, collected_at: null, note: '',
    }
    setRecords(rs => [...rs, mapRecord(newRec)])
    const { error } = await supabase.from('catering_collections').insert(newRec)
    if (error) { console.error('[catering] adhoc insert:', error); loadAll() }
    return newId
  }

  function setAdhocCollected(id, collected) {
    const collectedAt = collected ? new Date().toISOString() : null
    setRecords(rs => rs.map(r => r.id === id ? { ...r, collected, collectedAt } : r))
    supabase.from('catering_collections')
      .update({ collected, collected_at: collectedAt })
      .eq('id', id)
      .then(({ error }) => { if (error) loadAll() })
  }

  function setAdhocNote(id, note) {
    setRecords(rs => rs.map(r => r.id === id ? { ...r, note } : r))
    supabase.from('catering_collections')
      .update({ note })
      .eq('id', id)
      .then(({ error }) => { if (error) loadAll() })
  }

  function deleteAdhoc(id) {
    setRecords(rs => rs.filter(r => r.id !== id))
    supabase.from('catering_collections').delete().eq('id', id)
      .then(({ error }) => { if (error) loadAll() })
  }

  return {
    records, loading,
    getRecord, getAdhoc,
    setCollected, setNote,
    addAdhoc, setAdhocCollected, setAdhocNote, deleteAdhoc,
  }
}
