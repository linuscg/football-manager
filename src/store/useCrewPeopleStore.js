import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapPerson(row) {
  return {
    id:        row.id,
    name:      row.name       ?? '',
    email:     row.email      ?? '',
    phone:     row.phone      ?? '',
    notes:     row.notes      ?? '',
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
  }
}

// ─── Store hook ───────────────────────────────────────────────────────────────
// crew_people is cross-production — no production_id scoping needed.
// RLS handles visibility: you see your own people + anyone linked to a
// production you are a member of.

export function useCrewPeopleStore() {
  const [people,  setPeople]  = useState([])
  const [loading, setLoading] = useState(true)

  // Guards against the stale-load race: a slow loadAll must never land its
  // rows after a newer load began.
  const loadGenRef = useRef(0)

  async function loadAll() {
    const gen = ++loadGenRef.current
    // crew_people spans every production and can exceed Supabase's 1,000-row
    // per-request cap — fetch in pages until exhausted.
    const rows = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('crew_people')
        .select('*')
        .order('name')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[crew people store] loadAll:', error)
        if (gen === loadGenRef.current) setLoading(false)
        return
      }
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
    // A newer load started while we were fetching — discard this result.
    if (gen !== loadGenRef.current) return
    setPeople(rows.map(mapPerson))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // Unique topic per hook instance — duplicate joins on a fixed topic
    // conflict in supabase-js when several components mount the same hook.
    const channel = supabase
      .channel(`crew_people_changes_${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_people' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Find or create ────────────────────────────────────────────────────────
  // Returns the personId for the given name, creating a new record if needed.
  // Deduplicates by name (case-insensitive).

  async function findOrCreatePerson({ name, email = '', phone = '' }) {
    const trimmed = name?.trim()
    if (!trimmed) return null

    // Check local cache first (avoids a round-trip for the common case)
    const existing = people.find(
      p => p.name.trim().toLowerCase() === trimmed.toLowerCase()
    )
    if (existing) return existing.id

    const { data: { user } } = await supabase.auth.getUser()
    const id = crypto.randomUUID()
    const newPerson = {
      id,
      name:      trimmed,
      email:     email  ?? '',
      phone:     phone  ?? '',
      notes:     '',
      createdBy: user?.id ?? null,
      createdAt: new Date().toISOString(),
    }

    // Optimistic insert (sorted by name)
    setPeople(ps =>
      [...ps, newPerson].sort((a, b) => a.name.localeCompare(b.name))
    )

    const { error } = await supabase.from('crew_people').insert({
      id,
      created_by: user?.id ?? null,
      name:       trimmed,
      email:      email  ?? '',
      phone:      phone  ?? '',
      notes:      '',
    })
    if (error) {
      console.error('[crew people store] findOrCreatePerson:', error)
      loadAll()
      return null
    }
    return id
  }

  // ── Update a field on a person ─────────────────────────────────────────────

  async function updatePerson(id, field, value) {
    setPeople(ps => ps.map(p => p.id === id ? { ...p, [field]: value } : p))
    const colMap = { name: 'name', email: 'email', phone: 'phone', notes: 'notes' }
    const col = colMap[field] ?? field
    const { error } = await supabase.from('crew_people').update({ [col]: value }).eq('id', id)
    if (error) { console.error('[crew people store] updatePerson:', error); loadAll() }
  }

  // ── Delete a person ────────────────────────────────────────────────────────
  // Note: resources.person_id has ON DELETE SET NULL so linked rows are
  // automatically unlinked (not deleted).

  async function deletePerson(id) {
    setPeople(ps => ps.filter(p => p.id !== id))
    const { error } = await supabase.from('crew_people').delete().eq('id', id)
    if (error) { console.error('[crew people store] deletePerson:', error); loadAll() }
  }

  return {
    people,
    loading,
    findOrCreatePerson,
    updatePerson,
    deletePerson,
  }
}
