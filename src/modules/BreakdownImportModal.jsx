import { useState, useRef } from 'react'
import { extractPdfItems, parseBreakdownItems, buildBreakdownPlan } from '../lib/breakdownImport'
import { EXTRAS_CATEGORIES } from '../lib/extrasCategories'

const CAT_LABEL = Object.fromEntries(EXTRAS_CATEGORIES.map(c => [c.key, c.label]))

// Movie Magic breakdown → Additional Info on each scene (Scene Order view).
// Parsed in the browser; nothing is written until "Apply".
export default function BreakdownImportModal({ shootDays, castMembers, onApply, onClose }) {
  const [phase, setPhase] = useState('upload')   // upload | parsing | preview | applying | done | error
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [filter, setFilter] = useState('all')
  const fileRef = useRef(null)

  async function handleFile(file) {
    if (!file) return
    setFileName(file.name)
    setPhase('parsing')
    try {
      const items = await extractPdfItems(file)
      const scenes = parseBreakdownItems(items)
      if (!scenes.length) throw new Error('No scenes found. This importer reads Movie Magic "Breakdown" reports (one block per scene starting "Scene 12  INT  SET…").')
      setResult(buildBreakdownPlan(scenes, { shootDays, castMembers }))
      setPhase('preview')
    } catch (e) {
      console.error('[breakdown import]', e)
      setError(e.message || String(e))
      setPhase('error')
    }
  }

  async function apply() {
    setPhase('applying')
    let res
    try { res = await onApply(result.plan) } catch (e) { res = { ok: false, error: e.message } }
    if (res?.ok) { setPhase('done'); setTimeout(onClose, 900) }
    else { setError(res?.error || 'Import failed'); setPhase('error') }
  }

  const s = result?.summary
  const rows = (result?.preview ?? []).filter(p => filter === 'all' || p.status === filter)

  return (
    <div className="sched-import-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sched-import-modal">
        <div className="sched-import-head">
          <h2 className="sched-import-title">Upload Breakdown</h2>
          <button className="sched-import-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sched-import-body">
          {phase === 'upload' && (
            <div
              className={`sched-import-dropzone${dragOver ? ' is-over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
            >
              <div className="sched-import-dz-icon">↑</div>
              <div className="sched-import-dz-text">Drop a Movie Magic breakdown PDF here, or click to choose</div>
              <div className="sched-import-dz-sub">
                Props, wardrobe, SFX, stunts, SAs, notes… go into each scene&rsquo;s Additional Info.
                Scenes not on the schedule yet are added to Unscheduled. You&rsquo;ll see a preview first.
              </div>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files?.[0])} />
            </div>
          )}

          {(phase === 'parsing' || phase === 'applying' || phase === 'done') && (
            <div className="sched-import-status">
              {phase === 'done' ? <div className="sched-import-done">✓</div> : <div className="bd-spinner" />}
              <div>{phase === 'parsing' ? `Reading ${fileName}…` : phase === 'applying' ? 'Saving to the schedule…' : 'Imported'}</div>
            </div>
          )}

          {phase === 'error' && (
            <div className="sched-import-status">
              <div className="sched-import-error">{error}</div>
              <button className="pm-btn pm-btn--ghost" onClick={() => { setPhase('upload'); setError(null) }}>Try again</button>
            </div>
          )}

          {phase === 'preview' && result && (
            <>
              <div className="sched-import-summary">
                <span><strong>{s.total}</strong> scenes in breakdown</span>
                <span><strong>{s.matched}</strong> matched{s.strips > s.matched ? <> ({s.strips} schedule strips)</> : null}</span>
                <span><strong>{s.added}</strong> new → Unscheduled</span>
                <span><strong>{s.items}</strong> items</span>
                {s.newCast > 0 && <span><strong>{s.newCast}</strong> new cast</span>}
                {s.saGroups > 0 && <span><strong>{s.saGroups}</strong> SA groups linked</span>}
              </div>
              <div className="bd-cats">
                {s.catSummary.map(c => <span key={c.key} className="bd-cat-chip">{c.label} <strong>{c.count}</strong></span>)}
              </div>
              <div className="sched-import-tip">
                Matched scenes keep everything already typed on the schedule; only blank fields are filled.
                Re-uploading a newer breakdown replaces the items from the previous upload — items added or edited by hand are always kept{s.skippedDupes > 0 ? <>, and {s.skippedDupes} breakdown item{s.skippedDupes === 1 ? '' : 's'} already typed by hand won&rsquo;t be added twice</> : null}.
                {' '}Supporting artists keep their Movie Magic number and are linked to the DooD group with the same number, so each group counts once per day.
                {s.saPlaceholders > 0 && <> {s.saPlaceholders} unnamed SA count{s.saPlaceholders === 1 ? '' : 's'} from the schedule import will be replaced by the named groups.</>}
                {s.notInBreakdown.length > 0 && <> {s.notInBreakdown.length} scheduled scene{s.notInBreakdown.length === 1 ? '' : 's'} aren&rsquo;t in this breakdown and are left as they are.</>}
              </div>

              <div className="bd-filter">
                {[['all', 'All'], ['matched', 'Matched'], ['new', 'New']].map(([k, l]) => (
                  <button key={k} className={`schedule-view-btn${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
              <div className="sched-import-scenes">
                {rows.map(p => (
                  <div key={p.key} className={`sched-import-scene sched-import-scene--${p.status === 'new' ? 'new' : 'unchanged'}`}>
                    <span className={`bd-status bd-status--${p.status}`}>{p.status === 'new' ? 'NEW' : 'MATCHED'}</span>
                    <span className="sched-import-scene-num">{p.sceneNumber}</span>
                    <span className="sched-import-scene-tag">{p.intExt}</span>
                    <span className="sched-import-scene-set">{p.setName}</span>
                    <span className="sched-import-scene-tag">{p.dayNight}</span>
                    {p.storyDay && <span className="sched-import-scene-meta">SD {p.storyDay}</span>}
                    {p.pages && <span className="sched-import-scene-meta">{p.pages} pg</span>}
                    <span className="sched-import-scene-meta" title={p.dayLabel}>→ {p.dayLabel}</span>
                    <span className="sched-import-scene-changes">
                      {Object.entries(p.cats).map(([k, n]) => `${CAT_LABEL[k] ?? k} ${n}`).join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {phase === 'preview' && (
          <div className="sched-import-foot">
            <button className="pm-btn pm-btn--ghost" onClick={onClose}>Cancel</button>
            <button className="pm-btn pm-btn--primary" onClick={apply}>Apply breakdown</button>
          </div>
        )}
      </div>
    </div>
  )
}
