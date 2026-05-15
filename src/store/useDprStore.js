import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentProductionId, onProductionChange } from '../lib/productionContext'

function mapDpr(row) {
  return {
    id: row.id,
    productionId: row.production_id,
    shootDayId: row.shoot_day_id,
    unit: row.unit ?? 'Main Unit',
    country: row.country ?? '',
    prTotal: row.pr_total,
    breakfast: row.breakfast ?? '',
    unitCall: row.unit_call ?? '',
    firstShotAm: row.first_shot_am ?? '',
    lunchStart: row.lunch_start ?? '',
    lunchEnd: row.lunch_end ?? '',
    firstShotAfter: row.first_shot_after ?? '',
    estWrap: row.est_wrap ?? '',
    actualWrap: row.actual_wrap ?? '',
    totalHours: row.total_hours ?? '',
    splitDay: row.split_day ?? false,
    nightWork: row.night_work ?? false,
    sixthDay: row.sixth_day ?? false,
    bankHoliday: row.bank_holiday ?? false,
    techBaseAddress: row.tech_base_address ?? '',
    unitBaseAddress: row.unit_base_address ?? '',
    lunchLocation: row.lunch_location ?? '',
    scenesScheduled: row.scenes_scheduled ?? '',
    scenesShot: row.scenes_shot ?? '',
    partComplete: row.part_complete ?? '',
    scheduledNotShot: row.scheduled_not_shot ?? '',
    shotNotScheduled: row.shot_not_scheduled ?? '',
    dayComplete: row.day_complete ?? '',
    sceneSummaryNotes: row.scene_summary_notes ?? '',
    scenes: row.scenes ?? [],
    castMembers: row.cast_members ?? [],
    fittings: row.fittings ?? [],
    supportingArts: row.supporting_arts ?? [],
    childrensHours: row.childrens_hours ?? [],
    setUpsPrevious: row.set_ups_previous ?? 0,
    setUpsToday: row.set_ups_today ?? 0,
    camInventory: row.cam_inventory ?? {},
    soundPrevious: row.sound_previous ?? 0,
    soundToday: row.sound_today ?? 0,
    soundCardNumbers: row.sound_card_numbers ?? '',
    videoPrevious: Number(row.video_previous ?? 0),
    videoToday: Number(row.video_today ?? 0),
    timingsPrevious: row.timings_previous ?? '',
    timingsToday: row.timings_today ?? '',
    cateringEstimated: row.catering_estimated ?? 0,
    cateringActual: row.catering_actual ?? 0,
    scriptMinPrevEst: row.script_min_prev_est ?? '',
    scriptMinPrevAct: row.script_min_prev_act ?? '',
    scriptMinTodayEst: row.script_min_today_est ?? '',
    scriptMinTodayAct: row.script_min_today_act ?? '',
    saCountsCosts: row.sa_counts_costs ?? {},
    additionalCrew: row.additional_crew ?? '',
    additionalEquipment: row.additional_equipment ?? '',
    additionalFacilities: row.additional_facilities ?? '',
    otTocNotes: row.ot_toc_notes ?? '',
    vfxSfxNotes: row.vfx_sfx_notes ?? '',
    hsMedicalNotes: row.hs_medical_notes ?? '',
    notes: row.notes ?? '',
  }
}

const DB_FIELDS = {
  unit: 'unit', country: 'country', prTotal: 'pr_total',
  breakfast: 'breakfast', unitCall: 'unit_call', firstShotAm: 'first_shot_am',
  lunchStart: 'lunch_start', lunchEnd: 'lunch_end', firstShotAfter: 'first_shot_after',
  estWrap: 'est_wrap', actualWrap: 'actual_wrap', totalHours: 'total_hours',
  splitDay: 'split_day', nightWork: 'night_work', sixthDay: 'sixth_day', bankHoliday: 'bank_holiday',
  techBaseAddress: 'tech_base_address', unitBaseAddress: 'unit_base_address', lunchLocation: 'lunch_location',
  scenesScheduled: 'scenes_scheduled', scenesShot: 'scenes_shot', partComplete: 'part_complete',
  scheduledNotShot: 'scheduled_not_shot', shotNotScheduled: 'shot_not_scheduled',
  dayComplete: 'day_complete', sceneSummaryNotes: 'scene_summary_notes',
  scenes: 'scenes', castMembers: 'cast_members', fittings: 'fittings',
  supportingArts: 'supporting_arts', childrensHours: 'childrens_hours',
  setUpsPrevious: 'set_ups_previous', setUpsToday: 'set_ups_today', camInventory: 'cam_inventory',
  soundPrevious: 'sound_previous', soundToday: 'sound_today', soundCardNumbers: 'sound_card_numbers',
  videoPrevious: 'video_previous', videoToday: 'video_today',
  timingsPrevious: 'timings_previous', timingsToday: 'timings_today',
  cateringEstimated: 'catering_estimated', cateringActual: 'catering_actual',
  scriptMinPrevEst: 'script_min_prev_est', scriptMinPrevAct: 'script_min_prev_act',
  scriptMinTodayEst: 'script_min_today_est', scriptMinTodayAct: 'script_min_today_act',
  saCountsCosts: 'sa_counts_costs',
  additionalCrew: 'additional_crew', additionalEquipment: 'additional_equipment',
  additionalFacilities: 'additional_facilities',
  otTocNotes: 'ot_toc_notes', vfxSfxNotes: 'vfx_sfx_notes', hsMedicalNotes: 'hs_medical_notes',
  notes: 'notes',
}

export function useDprStore() {
  const [dprs, setDprs] = useState([])
  const [loading, setLoading] = useState(true)

  async function loadAll() {
    const prodId = getCurrentProductionId()
    if (!prodId) { setLoading(false); return }
    const { data, error } = await supabase
      .from('dpr_day')
      .select('*')
      .eq('production_id', prodId)
    if (!error) setDprs((data ?? []).map(mapDpr))
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    const unsub = onProductionChange(() => { setLoading(true); setDprs([]); loadAll() })
    const channel = supabase
      .channel('dpr_day_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dpr_day' }, loadAll)
      .subscribe()
    return () => { unsub(); supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function getDprForDay(shootDayId) {
    return dprs.find(d => d.shootDayId === shootDayId) ?? null
  }

  async function ensureDpr(shootDayId) {
    const existing = dprs.find(d => d.shootDayId === shootDayId)
    if (existing) return existing
    const prodId = getCurrentProductionId()
    const { data, error } = await supabase
      .from('dpr_day')
      .insert({ production_id: prodId, shoot_day_id: shootDayId })
      .select()
      .single()
    if (error) { console.error('[dpr] ensureDpr:', error); return null }
    const newDpr = mapDpr(data)
    setDprs(ds => [...ds, newDpr])
    return newDpr
  }

  async function updateDpr(id, field, value) {
    setDprs(ds => ds.map(d => d.id === id ? { ...d, [field]: value } : d))
    const dbField = DB_FIELDS[field] ?? field
    const { error } = await supabase.from('dpr_day').update({ [dbField]: value }).eq('id', id)
    if (error) { console.error('[dpr] updateDpr:', error); loadAll() }
  }

  return { dprs, loading, getDprForDay, ensureDpr, updateDpr }
}
