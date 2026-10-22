// ─── Per-user UI permission registry ──────────────────────────────────────────
// Static mirror of App.jsx's TOP_TABS + nav arrays, shared by the Admin
// permissions panel and the enforcement logic. Ids/labels must match App.jsx.
//
// Permissions are stored as DENIALS on production_members.permissions (jsonb),
// so an empty object means "everything visible":
//   { "deniedTabs": ["catering"], "deniedModules": ["ct-timesheets"], "denyCrewRates": true }

export const PERMISSION_TABS = [
  {
    id: 'setup',
    label: 'Admin',
    modules: [
      { id: 'setup-list',     label: 'Project List'    },
      { id: 'setup-main',     label: 'Project Setup'   },
      { id: 'setup-account',  label: 'Account'         },
      { id: 'setup-settings', label: 'Settings'        },
      { id: 'setup-admin',    label: 'User Management' },
      { id: 'setup-requests', label: 'Invite Requests' },
    ],
  },
  {
    id: 'fm',
    label: 'Football Manager',
    modules: [
      { id: 'schedule',  label: 'Schedule'      },
      { id: 'crew',      label: 'Equipment'     },
      { id: 'callsheet', label: 'Daily Info'    },
      { id: 'budget',    label: 'Cost Tracking' },
      { id: 'crew-db',   label: 'Crew Database' },
    ],
  },
  {
    id: 'crew-times',
    label: 'Crew',
    modules: [
      { id: 'ct-crew',       label: 'Fulltime Crew' },
      { id: 'ct-tracker',    label: 'Crew Tracker'  },
      { id: 'ct-backpage',   label: 'Backpage'      },
      { id: 'ct-timesheets', label: 'Timesheets'    },
      { id: 'ct-starters',   label: 'New Starters'  },
    ],
  },
  {
    id: 'catering',
    label: 'Catering',
    modules: [
      { id: 'cat-list',    label: 'Catering List'    },
      { id: 'cat-numbers', label: 'Catering Numbers' },
    ],
  },
  {
    id: 'accomm',
    label: 'Accommodation',
    modules: [
      { id: 'accomm-hotels', label: 'Hotel List'        },
      { id: 'accomm-crew',   label: 'Accommodation Log' },
      { id: 'accomm-tmo',    label: 'Weekly TMO'        },
      { id: 'accomm-travel', label: 'Travel Times'      },
    ],
  },
  {
    id: 'dpr',
    label: 'DPR',
    modules: [
      { id: 'dpr-main', label: 'DPR'         },
      { id: 'dpr-wrap', label: 'Wrap Report' },
    ],
  },
]

export const FEATURE_FLAGS = [
  {
    id: 'denyCrewRates',
    // Rendered as a positive "can see" checkbox (checked by default);
    // unchecking it writes denyCrewRates: true.
    label: 'Can see rates (Crew Tracker)',
    hint: 'When off: money columns & rate settings hidden; contact, dates, deal memo stay visible.',
  },
]

// Default (fully-permissive) shape for a missing / empty permissions value.
export const EMPTY_PERMISSIONS = Object.freeze({
  deniedTabs: Object.freeze([]),
  deniedModules: Object.freeze([]),
  denyCrewRates: false,
})

// Normalise a raw jsonb value into the full shape with defaults.
export function normalizePermissions(raw) {
  if (!raw || typeof raw !== 'object') return EMPTY_PERMISSIONS
  return {
    deniedTabs:    Array.isArray(raw.deniedTabs)    ? raw.deniedTabs    : [],
    deniedModules: Array.isArray(raw.deniedModules) ? raw.deniedModules : [],
    denyCrewRates: raw.denyCrewRates === true,
  }
}

// Strip empty/default keys so a fully-permissive user stores plain {}.
export function cleanPermissions(perms) {
  const out = {}
  if (perms.deniedTabs?.length)    out.deniedTabs    = perms.deniedTabs
  if (perms.deniedModules?.length) out.deniedModules = perms.deniedModules
  if (perms.denyCrewRates === true) out.denyCrewRates = true
  return out
}
