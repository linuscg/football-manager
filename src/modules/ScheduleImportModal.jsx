import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { reconcileSchedule } from '../lib/reconcileSchedule'

// Status badge for days / scenes.
function StatusBadge({ status }) {
  const label = status === 'new' ? 'NEW' : status === 'changed' ? 'CHANGED' : 'UNCHANGED'
  return <span className={`sched-import-badge sched-import-badge--${status}`}>{label}</span>
}

// Labeled stages for the parsing flow (drives the stepper + progress bar).
const PARSE_STAGES = ['Reading file', 'Parsing schedule', 'Matching to schedule']

// Staged progress bar: a stepper of labels + a fill bar.
function StagedProgress({ stages, stageIdx, progress, caption }) {
  return (
    <div className="sched-import-progress">
      <div className="sched-import-stages">
        {stages.map((label, i) => (
          <div
            key={label}
            className={`sched-import-stage${
              i < stageIdx ? ' is-done' : i === stageIdx ? ' is-active' : ''
            }`}
          >
            <span className="sched-import-stage-dot">{i < stageIdx ? '✓' : i + 1}</span>
            <span className="sched-import-stage-label">{label}</span>
          </div>
        ))}
      </div>
      <div className="sched-import-progress-track">
        <div className="sched-import-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      {caption && <div className="sched-import-dz-sub">{caption}</div>}
    </div>
  )
}

export default function ScheduleImportModal({ existing, onClose, onApply }) {
  // phase: 'upload' | 'parsing' | 'preview' | 'applying' | 'error' | 'done'
  const [phase, setPhase]   = useState('upload')
  const [error, setError]   = useState(null)
  const [plan, setPlan]     = useState(null)
  const [preview, setPreview] = useState(null)   // editable copy of plan.preview (drag-drop)
  const [dropTargetKey, setDropTargetKey] = useState(null)
  const [dropSceneKey, setDropSceneKey] = useState(null)  // scene row being targeted for insertion
  const dragRef = useRef(null)                    // { sceneKey, sourceDayKey }
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [delDays, setDelDays]     = useState(() => new Set())  // day ids opted in for deletion
  const [delScenes, setDelScenes] = useState(() => new Set())  // scene ids opted in for deletion
  const fileRef = useRef(null)

  // ── Progress bar state ───────────────────────────────────────────────────────
  const [progress, setProgress] = useState(0)
  const [stageIdx, setStageIdx] = useState(0)
  const creepRef = useRef(null)

  function stopCreep() {
    if (creepRef.current) { clearInterval(creepRef.current); creepRef.current = null }
  }

  // Ease the bar toward `cap` (never reaching it) so the wait feels alive
  // even though the parse gives us no real progress signal. `speed` scales how
  // fast it eases — the parse stage (~50s) uses a slow value so the bar doesn't
  // hit the cap and sit there.
  function startCreep(cap, speed = 0.06) {
    stopCreep()
    creepRef.current = setInterval(() => {
      setProgress(p => (p < cap ? p + Math.max(0.15, (cap - p) * speed) : p))
    }, 400)
  }

  // Clean up the interval if the modal unmounts mid-flight.
  useEffect(() => stopCreep, [])

  // ── File → base64 → edge function → reconcile ──────────────────────────────
  function handleFile(file) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.')
      setPhase('error')
      return
    }
    setFileName(file.name)
    setPhase('parsing')
    setError(null)
    // Stage 1 — reading the file.
    setStageIdx(0)
    setProgress(5)
    startCreep(18)

    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const b64 = reader.result.split(',')[1]
        // Stage 2 — AI analysis (the long one; creep toward 75%).
        stopCreep()
        setStageIdx(1)
        setProgress(22)
        // Parsing is the long pole (~50s) — ease very slowly toward 75%.
        startCreep(75, 0.012)
        const { data, error: fnErr } = await supabase.functions.invoke('parse-schedule-pdf', {
          body: { pdfBase64: b64 },
        })
        stopCreep()
        if (fnErr || data?.error) {
          // supabase.functions.invoke gives a generic "non-2xx" message —
          // the real error body lives on fnErr.context (the Response).
          let detail = data?.error ?? null
          if (!detail && fnErr?.context && typeof fnErr.context.json === 'function') {
            try {
              const body = await fnErr.context.json()
              detail = body?.error ?? (body ? JSON.stringify(body) : null)
            } catch { /* ignore */ }
          }
          setError(detail ?? fnErr?.message ?? 'Failed to parse the schedule.')
          setPhase('error')
          return
        }
        const result = data?.result
        if (!result) {
          setError('No schedule data could be read from this PDF.')
          setPhase('error')
          return
        }
        // Stage 3 — matching against the existing schedule.
        setStageIdx(2)
        setProgress(85)
        const p = reconcileSchedule(result, existing)
        setPlan(p)
        // Deep-ish clone of preview so drag-drop edits don't mutate the base plan.
        setPreview(p.preview.map(d => ({ ...d, scenes: d.scenes.map(sc => ({ ...sc })) })))
        setProgress(100)
        setPhase('preview')
      } catch (err) {
        stopCreep()
        setError(err.message ?? 'Unexpected error parsing the PDF.')
        setPhase('error')
      }
    }
    reader.onerror = () => {
      stopCreep()
      setError('Could not read the file.')
      setPhase('error')
    }
    reader.readAsDataURL(file)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  // ── Rebuild commit lists from the (possibly drag-edited) preview ─────────────
  // The preview is the source of truth for scene→day assignment. We derive fresh
  // scenesToInsert / scenesToUpdate from it, and prune NEW days left empty by a move.
  function buildPlanFromPreview(editedPreview, basePlan) {
    const scenesToInsert = []
    const scenesToUpdate = []

    for (const day of editedPreview) {
      day.scenes.forEach((sc, idx) => {
        const fields = {
          dayId:         day.dayKey,
          sceneNumber:   sc.sceneNumber ?? '',
          intExt:        sc.intExt ?? 'INT',
          location:      sc.location ?? sc.setName ?? '',
          dayNight:      sc.dayNight ?? 'DAY',
          description:   sc.commitDescription ?? sc.description ?? '',
          pages:         sc.pages ?? '',
          storyDay:      sc.storyDay ?? '',
          castMemberIds: sc.castMemberIds ?? [],
          sortOrder:     idx,
        }
        if (sc.commitKind === 'update') {
          scenesToUpdate.push({ id: sc.existingId, ...fields })
        } else {
          scenesToInsert.push({ id: sc.existingId ?? crypto.randomUUID(), ...fields })
        }
      })
    }

    // Drop NEW days that *originally* carried scenes but were emptied by a drag
    // (a phantom page-break split whose scenes were all moved onto the real day).
    // Keep new days that legitimately have no scenes (e.g. an imported prep day).
    const origSceneCountByKey = {}
    for (const p of (basePlan.preview ?? [])) {
      origSceneCountByKey[p.dayKey] = (p.scenes ?? []).length
    }
    const daysToInsert = (basePlan.daysToInsert ?? []).filter(d => {
      const nowScenes = editedPreview.find(p => p.dayKey === d.id)?.scenes.length ?? 0
      const hadScenes = origSceneCountByKey[d.id] ?? 0
      // prune only if it had scenes before and has none now
      return !(hadScenes > 0 && nowScenes === 0)
    })

    return {
      ...basePlan,
      daysToInsert,
      scenesToInsert,
      scenesToUpdate,
    }
  }

  // ── Drag-and-drop in the preview ─────────────────────────────────────────────
  function onSceneDragStart(e, sceneKey, sourceDayKey) {
    dragRef.current = { sceneKey, sourceDayKey }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', sceneKey)
  }
  function onDayDragOver(e, dayKey) {
    if (!dragRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTargetKey !== dayKey) setDropTargetKey(dayKey)
  }
  function onDayDragLeave(dayKey) {
    setDropTargetKey(k => (k === dayKey ? null : k))
  }
  // Move the dragged scene into `targetDayKey`. If `targetIndex` is null the
  // scene is appended to the end of that day; otherwise it is inserted at that
  // index. Works both within a day (reorder) and across days (move + position).
  function moveScene(drag, targetDayKey, targetIndex) {
    if (!drag) return
    setPreview(prev => {
      if (!prev) return prev
      let moved = null
      const stripped = prev.map(d => {
        if (d.dayKey !== drag.sourceDayKey) return d
        const keep = []
        for (const sc of d.scenes) {
          if (sc.sceneKey === drag.sceneKey) moved = sc
          else keep.push(sc)
        }
        return { ...d, scenes: keep }
      })
      if (!moved) return prev
      return stripped.map(d => {
        if (d.dayKey !== targetDayKey) return d
        if (targetIndex == null) return { ...d, scenes: [...d.scenes, moved] }
        const scenes = [...d.scenes]
        const idx = Math.min(Math.max(targetIndex, 0), scenes.length)
        scenes.splice(idx, 0, moved)
        return { ...d, scenes }
      })
    })
  }

  function onDayDrop(e, targetDayKey) {
    e.preventDefault()
    setDropTargetKey(null)
    setDropSceneKey(null)
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.sourceDayKey === targetDayKey) return
    moveScene(drag, targetDayKey, null)
  }

  // Dropping onto another scene row inserts the dragged scene at that scene's
  // index within its day. stopPropagation keeps the day-card drop from firing.
  function onSceneDragOver(e, sceneKey) {
    if (!dragRef.current) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dropSceneKey !== sceneKey) setDropSceneKey(sceneKey)
  }
  function onSceneDrop(e, targetDayKey, targetSceneKey) {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetKey(null)
    setDropSceneKey(null)
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.sceneKey === targetSceneKey) return
    setPreview(prev => {
      if (!prev) return prev
      let moved = null
      const stripped = prev.map(d => {
        if (d.dayKey !== drag.sourceDayKey) return d
        const keep = []
        for (const sc of d.scenes) {
          if (sc.sceneKey === drag.sceneKey) moved = sc
          else keep.push(sc)
        }
        return { ...d, scenes: keep }
      })
      if (!moved) return prev
      return stripped.map(d => {
        if (d.dayKey !== targetDayKey) return d
        const scenes = [...d.scenes]
        // Re-find target index after removal (target scene is still present);
        // insert the dragged scene at the target scene's position.
        let idx = scenes.findIndex(sc => sc.sceneKey === targetSceneKey)
        if (idx < 0) idx = scenes.length
        scenes.splice(idx, 0, moved)
        return { ...d, scenes }
      })
    })
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  async function handleApply() {
    setPhase('applying')
    setError(null)
    setProgress(8)
    startCreep(90)
    const rebuilt = preview ? buildPlanFromPreview(preview, plan) : plan
    const finalPlan = {
      ...rebuilt,
      dayIdsToDelete:   [...delDays],
      sceneIdsToDelete: [...delScenes],
    }
    const res = await onApply(finalPlan)
    stopCreep()
    if (res?.ok) {
      setProgress(100)
      setPhase('done')
      setTimeout(() => onClose(), 1100)
    } else {
      setError(res?.error ?? 'Failed to apply the import.')
      setPhase('error')
    }
  }

  function toggleDelDay(id) {
    setDelDays(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleDelScene(id) {
    setDelScenes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const s = plan?.summary

  return (
    <div className="sched-import-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sched-import-modal">
        <div className="sched-import-head">
          <h2 className="sched-import-title">Import Schedule from PDF</h2>
          <button className="sched-import-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sched-import-body">
          {/* ── Upload ── */}
          {phase === 'upload' && (
            <div
              className={`sched-import-dropzone${dragOver ? ' is-over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="sched-import-dz-icon">↑</div>
              <div className="sched-import-dz-text">Drop a schedule PDF here, or click to choose</div>
              <div className="sched-import-dz-sub">We&rsquo;ll parse it and show you a preview before anything changes.</div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files?.[0])}
              />
            </div>
          )}

          {/* ── Parsing ── */}
          {phase === 'parsing' && (
            <StagedProgress
              stages={PARSE_STAGES}
              stageIdx={stageIdx}
              progress={progress}
              caption={fileName}
            />
          )}

          {/* ── Applying ── */}
          {phase === 'applying' && (
            <StagedProgress
              stages={['Saving changes']}
              stageIdx={0}
              progress={progress}
              caption="Writing days, scenes and cast to your schedule…"
            />
          )}

          {/* ── Done ── */}
          {phase === 'done' && (
            <div className="sched-import-status">
              <div className="sched-import-done">✓</div>
              <div>Imported</div>
            </div>
          )}

          {/* ── Error ── */}
          {phase === 'error' && (
            <div className="sched-import-status">
              <div className="sched-import-error">{error}</div>
              <button className="pm-btn pm-btn--ghost" onClick={() => { setPhase('upload'); setError(null) }}>
                Try again
              </button>
            </div>
          )}

          {/* ── Preview ── */}
          {phase === 'preview' && plan && (
            <>
              <div className="sched-import-summary">
                <span><strong>{s.newDays}</strong> new days</span>
                <span><strong>{s.changedDays}</strong> changed days</span>
                <span><strong>{s.newScenes}</strong> new scenes</span>
                <span><strong>{s.changedScenes}</strong> changed scenes</span>
                <span><strong>{s.newCast}</strong> new cast</span>
              </div>

              <div className="sched-import-tip">
                Tip: drag a scene onto another day to move it, or onto another scene to reorder it within a day.
              </div>

              {plan.castToInsert?.length > 0 && (
                <div className="sched-import-cast">
                  <div className="sched-import-cast-title">
                    New cast to be created ({plan.castToInsert.length})
                  </div>
                  <div className="sched-import-cast-list">
                    {plan.castToInsert
                      .slice()
                      .sort((a, b) => (parseInt(a.castNumber, 10) || 999) - (parseInt(b.castNumber, 10) || 999))
                      .map(c => (
                        <span key={c.id} className="sched-import-cast-chip">
                          {c.castNumber && <strong>{c.castNumber}</strong>} {c.name}
                          {c.notes && <em> ({c.notes})</em>}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              <div className="sched-import-days">
                {(preview ?? plan.preview).map((d, i) => (
                  <div
                    key={d.dayKey ?? i}
                    className={`sched-import-day sched-import-day--${d.status}${dropTargetKey === d.dayKey ? ' is-drop-target' : ''}`}
                    onDragOver={e => onDayDragOver(e, d.dayKey)}
                    onDragLeave={() => onDayDragLeave(d.dayKey)}
                    onDrop={e => onDayDrop(e, d.dayKey)}
                  >
                    <div className="sched-import-day-head">
                      <StatusBadge status={d.status} />
                      <span className="sched-import-day-title">
                        {d.dayNumber != null ? `Day ${d.dayNumber}` : (d.dayCategory || 'Day').toUpperCase()}
                      </span>
                      {d.date && <span className="sched-import-day-meta">{d.date}</span>}
                      {d.location && <span className="sched-import-day-meta">{d.location}</span>}
                      {d.dayCategory && d.dayCategory !== 'main' && (
                        <span className="sched-import-day-cat">{d.dayCategory}</span>
                      )}
                    </div>
                    {d.notes && d.notes.trim() && (
                      <div className="sched-import-day-notes">
                        <span className="sched-import-day-notes-label">Notes</span>
                        {d.notes}
                      </div>
                    )}
                    {d.scenes.length > 0 && (
                      <div className="sched-import-scenes">
                        {d.scenes.map((sc, j) => (
                          <div
                            key={sc.sceneKey ?? j}
                            className={`sched-import-scene sched-import-scene--${sc.status}${dropSceneKey === sc.sceneKey ? ' is-scene-drop-target' : ''}`}
                            draggable
                            onDragStart={e => onSceneDragStart(e, sc.sceneKey, d.dayKey)}
                            onDragOver={e => onSceneDragOver(e, sc.sceneKey)}
                            onDragLeave={() => setDropSceneKey(k => (k === sc.sceneKey ? null : k))}
                            onDrop={e => onSceneDrop(e, d.dayKey, sc.sceneKey)}
                          >
                            <StatusBadge status={sc.status} />
                            <span className="sched-import-scene-num">{sc.sceneNumber || '—'}</span>
                            <span className="sched-import-scene-tag">{sc.intExt}</span>
                            <span className="sched-import-scene-set">{sc.setName}</span>
                            <span className="sched-import-scene-tag">{sc.dayNight}</span>
                            {sc.storyDay && <span className="sched-import-scene-meta">SD {sc.storyDay}</span>}
                            {sc.pages && <span className="sched-import-scene-meta">{sc.pages} pg</span>}
                            {sc.castNumbers?.length > 0 && (
                              <span className="sched-import-scene-meta">cast {sc.castNumbers.join(', ')}</span>
                            )}
                            {sc.changes?.length > 0 && (
                              <span className="sched-import-scene-changes">{sc.changes.join(', ')}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── Not in this PDF ── */}
              {(plan.daysUnmatched.length > 0 || plan.scenesUnmatched.length > 0) && (
                <div className="sched-import-unmatched">
                  <button
                    className="sched-import-unmatched-toggle"
                    onClick={() => setShowUnmatched(v => !v)}
                  >
                    {showUnmatched ? '▾' : '▸'} Not in this PDF
                    {' '}({plan.daysUnmatched.length} days, {plan.scenesUnmatched.length} scenes)
                  </button>
                  {showUnmatched && (
                    <div className="sched-import-unmatched-body">
                      <div className="sched-import-unmatched-note">
                        These exist in your schedule but weren&rsquo;t found in the PDF. Tick to remove them.
                      </div>
                      {plan.daysUnmatched.map(d => (
                        <label key={d.id} className="sched-import-unmatched-row">
                          <input
                            type="checkbox"
                            checked={delDays.has(d.id)}
                            onChange={() => toggleDelDay(d.id)}
                          />
                          <span>Day &mdash; {d.label}</span>
                        </label>
                      ))}
                      {plan.scenesUnmatched.map(sc => (
                        <label key={sc.id} className="sched-import-unmatched-row">
                          <input
                            type="checkbox"
                            checked={delScenes.has(sc.id)}
                            onChange={() => toggleDelScene(sc.id)}
                          />
                          <span>Scene {sc.sceneNumber || '—'} on {sc.dayLabel}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {phase === 'preview' && (
          <div className="sched-import-foot">
            <button className="pm-btn pm-btn--ghost" onClick={onClose}>Cancel</button>
            <button className="pm-btn pm-btn--primary" onClick={handleApply}>Apply Import</button>
          </div>
        )}
      </div>
    </div>
  )
}
