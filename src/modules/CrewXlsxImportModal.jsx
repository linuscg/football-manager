import { useState } from 'react'

// ─── Crew tracker Excel import — diff approval modal ──────────────────────────
//
// Shown after an .xlsx crew tracker upload is parsed and diffed against the
// existing crew. Lists NEW people and CHANGED people (with a per-field list);
// every row has a checkbox (default checked). Reuses the schedule-import
// modal's visual language (.sched-import-* classes).

function Badge({ status }) {
  const label = status === 'new' ? 'NEW' : 'CHANGED'
  return <span className={`sched-import-badge sched-import-badge--${status}`}>{label}</span>
}

const fmt = v => (v === '' || v === null || v === undefined ? '—' : String(v))

export default function CrewXlsxImportModal({ diff, crewClassLabel, onCancel, onApply }) {
  const { newPeople, changed, unchangedCount, ambiguous = [] } = diff

  // Selection state — default: everything checked
  const [newChecked, setNewChecked] = useState(() => new Set(newPeople.map((_, i) => i)))
  const [chgChecked, setChgChecked] = useState(() => new Set(changed.map(c => c.resource.id)))

  const toggle = (setter, key) => setter(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const selectedCount = newChecked.size + chgChecked.size

  function handleApply() {
    onApply(
      newPeople.filter((_, i) => newChecked.has(i)),
      changed.filter(c => chgChecked.has(c.resource.id)),
    )
  }

  return (
    <div className="sched-import-backdrop" onClick={onCancel}>
      <div className="sched-import-modal" onClick={e => e.stopPropagation()}>
        <div className="sched-import-head">
          <h3 className="sched-import-title">Crew Tracker Import</h3>
          <button className="sched-import-close" onClick={onCancel}>×</button>
        </div>

        <div className="sched-import-body">
          <div className="sched-import-summary">
            <strong>
              {newPeople.length} new · {changed.length} changed · {unchangedCount} unchanged
            </strong>
            <span className="sched-import-day-meta">
              Untick anyone you don't want to import. New people are added to the {crewClassLabel} crew list.
            </span>
          </div>

          {ambiguous.length > 0 && (
            <div className="admin-send-result admin-send-result--err" style={{ marginBottom: 12 }}>
              Skipped (same name appears more than once, so a safe match isn't
              possible — update these manually): {ambiguous.join(', ')}
            </div>
          )}

          <div className="sched-import-days">
            {newPeople.map((p, i) => (
              <div key={`new-${i}`} className="sched-import-day sched-import-day--new">
                <label className="sched-import-day-head crew-xlsx-row">
                  <input
                    type="checkbox"
                    checked={newChecked.has(i)}
                    onChange={() => toggle(setNewChecked, i)}
                  />
                  <Badge status="new" />
                  <span className="sched-import-day-title">{p.name}</span>
                  <span className="sched-import-day-meta">
                    {[p.role, p.department, p.weeklyRate != null ? `£${p.weeklyRate}/wk` : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                </label>
              </div>
            ))}

            {changed.map(entry => (
              <div key={entry.resource.id} className="sched-import-day sched-import-day--changed">
                <label className="sched-import-day-head crew-xlsx-row">
                  <input
                    type="checkbox"
                    checked={chgChecked.has(entry.resource.id)}
                    onChange={() => toggle(setChgChecked, entry.resource.id)}
                  />
                  <Badge status="changed" />
                  <span className="sched-import-day-title">{entry.person.name}</span>
                  <span className="sched-import-day-meta">
                    {entry.changes.length} field{entry.changes.length !== 1 ? 's' : ''}
                  </span>
                </label>
                <div className="sched-import-scenes">
                  {entry.changes.map(ch => (
                    <div key={ch.field} className="sched-import-scene sched-import-scene--changed">
                      <span className="crew-xlsx-field">{ch.label}:</span>
                      <span className="crew-xlsx-from">{fmt(ch.from)}</span>
                      <span className="crew-xlsx-arrow">→</span>
                      <span className="crew-xlsx-to">{fmt(ch.to)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {!newPeople.length && !changed.length && (
              <div className="sched-import-day sched-import-day--unchanged">
                <div className="sched-import-day-head">
                  <span className="sched-import-day-meta">
                    Everyone in the sheet already matches the crew list — nothing to import.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sched-import-foot">
          <button className="pm-btn pm-btn--ghost" onClick={onCancel}>Cancel</button>
          <button
            className="pm-btn pm-btn--primary"
            onClick={handleApply}
            disabled={!selectedCount}
          >
            Apply Import
          </button>
        </div>
      </div>
    </div>
  )
}
