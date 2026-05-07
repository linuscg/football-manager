import { useState, useEffect } from 'react'

const STORAGE_KEY = 'fm_schedule_v1'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveToStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

const defaultState = {
  production: { name: 'Untitled Production', prepStartDate: '' },
  shootDays: [],
}

export function useScheduleStore() {
  const [store, setStore] = useState(() => loadFromStorage() ?? defaultState)

  // Persist on every change
  useEffect(() => {
    saveToStorage(store)
  }, [store])

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function updateStore(updater) {
    setStore(prev => {
      const next = updater(prev)
      return next
    })
  }

  // ─── Production ───────────────────────────────────────────────────────────

  function setProductionName(name) {
    updateStore(s => ({ ...s, production: { ...s.production, name } }))
  }

  function setPrepStartDate(date) {
    updateStore(s => ({ ...s, production: { ...s.production, prepStartDate: date } }))
  }

  // ─── Shoot Days ───────────────────────────────────────────────────────────

  function addShootDay() {
    updateStore(s => {
      const days = s.shootDays
      const lastDayNum = days.length
        ? Math.max(...days.map(d => d.dayNumber ?? 0))
        : 0

      // Auto-advance date from the last day that has one
      const sorted = [...days].filter(d => d.date).sort((a, b) =>
        a.date < b.date ? -1 : 1
      )
      let nextDate = ''
      if (sorted.length) {
        const last = new Date(sorted[sorted.length - 1].date + 'T00:00:00')
        last.setDate(last.getDate() + 1)
        nextDate = last.toISOString().split('T')[0]
      }

      const newDay = {
        id: generateId(),
        dayNumber: lastDayNum + 1,
        date: nextDate,
        location: '',
        unitBase: '',
        generalCall: '',
        isNonShootDay: false,
        scenes: [],
        notes: '',
      }

      return { ...s, shootDays: [...days, newDay] }
    })
  }

  function deleteShootDay(id) {
    updateStore(s => ({
      ...s,
      shootDays: s.shootDays.filter(d => d.id !== id),
    }))
  }

  function updateShootDay(id, field, value) {
    updateStore(s => ({
      ...s,
      shootDays: s.shootDays.map(d =>
        d.id === id ? { ...d, [field]: value } : d
      ),
    }))
  }

  function moveDayUp(id) {
    updateStore(s => {
      const days = [...s.shootDays]
      const idx = days.findIndex(d => d.id === id)
      if (idx <= 0) return s
      ;[days[idx - 1], days[idx]] = [days[idx], days[idx - 1]]
      return { ...s, shootDays: days }
    })
  }

  function moveDayDown(id) {
    updateStore(s => {
      const days = [...s.shootDays]
      const idx = days.findIndex(d => d.id === id)
      if (idx < 0 || idx >= days.length - 1) return s
      ;[days[idx], days[idx + 1]] = [days[idx + 1], days[idx]]
      return { ...s, shootDays: days }
    })
  }

  function reorderDays(fromId, toId) {
    updateStore(s => {
      const days = [...s.shootDays]
      const fromIdx = days.findIndex(d => d.id === fromId)
      const toIdx = days.findIndex(d => d.id === toId)
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return s
      const [moved] = days.splice(fromIdx, 1)
      days.splice(toIdx, 0, moved)
      return { ...s, shootDays: days }
    })
  }

  // ─── Scenes ───────────────────────────────────────────────────────────────

  function addScene(dayId) {
    updateStore(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        if (d.id !== dayId) return d
        return {
          ...d,
          scenes: [
            ...d.scenes,
            {
              id: generateId(),
              sceneNumber: '',
              intExt: 'INT',
              location: '',
              dayNight: 'DAY',
              description: '',
              pages: '',
            },
          ],
        }
      }),
    }))
  }

  function deleteScene(dayId, sceneId) {
    updateStore(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        if (d.id !== dayId) return d
        return { ...d, scenes: d.scenes.filter(sc => sc.id !== sceneId) }
      }),
    }))
  }

  function updateScene(dayId, sceneId, field, value) {
    updateStore(s => ({
      ...s,
      shootDays: s.shootDays.map(d => {
        if (d.id !== dayId) return d
        return {
          ...d,
          scenes: d.scenes.map(sc =>
            sc.id === sceneId ? { ...sc, [field]: value } : sc
          ),
        }
      }),
    }))
  }

  return {
    store,
    // production
    setProductionName,
    setPrepStartDate,
    // days
    addShootDay,
    deleteShootDay,
    updateShootDay,
    moveDayUp,
    moveDayDown,
    reorderDays,
    // scenes
    addScene,
    deleteScene,
    updateScene,
  }
}
