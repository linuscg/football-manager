// "Additional Info" categories (day_extras.category). Rows are stored per shoot
// day; a row with scene_id set belongs to that scene (Scene Order shows it in
// the scene's row, and it moves with the scene when the scene changes day).
//
// `callSheet: false` categories are breakdown detail (props, wardrobe, notes…)
// that stays off the call sheet / schedule PDF — they can carry internal notes.
export const EXTRAS_CATEGORIES = [
  { key: 'animals',  label: 'Animals',            callSheet: true },
  { key: 'risk',     label: 'Risk Assessments',   callSheet: true },
  { key: 'stunts',   label: 'Stunts',             callSheet: true },
  { key: 'vfx',      label: 'VFX',                callSheet: true },
  { key: 'extras',   label: 'Supporting Artists', callSheet: true },
  { key: 'standins', label: 'Stand-ins',          callSheet: true },   // crew, not in SA counts
  { key: 'other',    label: 'Other',              callSheet: true },
  { key: 'visitors', label: 'Visitors',           callSheet: true },
  { key: 'props',    label: 'Props',              callSheet: false },
  { key: 'wardrobe', label: 'Wardrobe',           callSheet: false },
  { key: 'makeup',   label: 'Makeup / Hair',      callSheet: false },
  { key: 'sfx',      label: 'SFX',                callSheet: false },
  { key: 'art',      label: 'Art Dept',           callSheet: false },
  { key: 'vehicles', label: 'Vehicles',           callSheet: false },
  { key: 'weapons',  label: 'Weapons',            callSheet: false },
  { key: 'labour',   label: 'Additional Labour',  callSheet: false },
  { key: 'notes',    label: 'Notes',              callSheet: false },
]
