import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

function mapStatus(row) {
  return {
    id:                    row.id,
    productionId:          row.production_id,
    crewType:              row.crew_type,
    crewId:                row.crew_id,
    addedToScenechronize:  row.added_to_scenechronize ?? false,
    sentContract:          row.sent_contract          ?? false,
    emailSent:             row.email_sent             ?? false,
    emailDelivered:        row.email_delivered        ?? false,
    memoSent:              row.memo_sent              ?? false,
    memoDelivered:         row.memo_delivered         ?? false,
    notes:                 row.notes                  ?? '',
  }
}

export function useNewStartersStore() {
  const [statuses, setStatuses] = useState([])
  const [loading,  setLoading]  = useState(true)

  // Guards against the production-switch race: a slow loadAll for the previous
  // production must never land its rows after a newer load began.
  const loadGenRef = useRef(0)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) return
    const gen = ++loadGenRef.current
    const { data, error } = await supabase
      .from('new_starter_status')
      .select('*')
      .eq('production_id', prodId)
    // A newer load (production switch) started while we were fetching —
    // discard this result instead of overwriting the newer production.
    if (gen !== loadGenRef.current) return
    if (error) { console.error('[new starters store] loadAll:', error); setLoading(false); return }
    setStatuses((data ?? []).map(mapStatus))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setLoading(true); setStatuses([]); loadAll() })
    // Unique topic per hook instance — duplicate joins on a fixed topic
    // conflict in supabase-js when several components mount the same hook.
    const channel = supabase
      .channel(`new_starter_status_changes_${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'new_starter_status' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Get or create a status record for a crew member
  function getStatus(crewId) {
    return statuses.find(s => s.crewId === crewId) ?? null
  }

  async function updateStatus(crewId, crewType, field, value) {
    const prodId = getCurrentProductionId()
    const existing = statuses.find(s => s.crewId === crewId)

    // Optimistic
    if (existing) {
      setStatuses(ss => ss.map(s => s.crewId === crewId ? { ...s, [field]: value } : s))
    } else {
      const placeholder = {
        id: crypto.randomUUID(), productionId: prodId, crewType, crewId,
        addedToScenechronize: false, sentContract: false,
        emailSent: false, emailDelivered: false,
        memoSent: false, memoDelivered: false, notes: '',
        [field]: value,
      }
      setStatuses(ss => [...ss, placeholder])
    }

    const colMap = {
      addedToScenechronize: 'added_to_scenechronize',
      sentContract:         'sent_contract',
      emailSent:            'email_sent',
      emailDelivered:       'email_delivered',
      memoSent:             'memo_sent',
      memoDelivered:        'memo_delivered',
      notes:                'notes',
    }
    const col = colMap[field] ?? field

    const { error } = await supabase
      .from('new_starter_status')
      .upsert({
        production_id:          prodId,
        crew_type:              crewType,
        crew_id:                crewId,
        ...(existing
          ? { [col]: value }
          : {
              added_to_scenechronize: false,
              sent_contract:          false,
              email_sent:             false,
              email_delivered:        false,
              notes:                  '',
              [col]:                  value,
            }
        ),
      }, { onConflict: 'production_id,crew_id' })

    if (error) { console.error('[new starters store] updateStatus:', error); loadAll() }
  }

  return { statuses, loading, getStatus, updateStatus }
}
