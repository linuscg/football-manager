import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { reconcileCastList } from '../lib/reconcileCastList'

// Status badge for cast rows.
function StatusBadge({ status }) {
  const label = status === 'new' ? 'NEW' : status === 'changed' ? 'CHANGED' : 'UNCHANGED'
  return <span className={`sched-import-badge sched-import-badge--${status}`}>{label}</span>
}

// Labeled stages for the parsing flow (drives the stepper + progress bar).
const PARSE_STAGES = ['Reading file', 'Parsing cast list', 'Matching to your cast']

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

export default function CastListImportModal({ existingCast = [], onClose, onApply }) {
  // phase: 'upload' | 'parsing' | 'preview' | 'applying' | 'error' | 'done'
  const [phase, setPhase]   = useState('upload')
  const [error, setError]   = useState(null)
  const [plan, setPlan]     = useState(null)
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  // ── Progress bar state ───────────────────────────────────────────────────────
  const [progress, setProgress] = useState(0)
  const [stageIdx, setStageIdx] = useState(0)
  const creepRef = useRef(null)

  function stopCreep() {
    if (creepRef.current) { clearInterval(creepRef.current); creepRef.current = null }
  }

  // Ease the bar toward `cap` (never reaching it) so the wait feels alive even
  // though the parse gives no real progress signal.
  function startCreep(cap, speed = 0.06) {
    stopCreep()
    creepRef.current = setInterval(() => {
      setProgress(p => (p < cap ? p + Math.max(0.15, (cap - p) * speed) : p))
    }, 400)
  }

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
        // Stage 2 — AI analysis (the long one; creep slowly toward 75%).
        stopCreep()
        setStageIdx(1)
        setProgress(22)
        startCreep(75, 0.012)
        const { data, error: fnErr } = await supabase.functions.invoke('parse-cast-list-pdf', {
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
          setError(detail ?? fnErr?.message ?? 'Failed to parse the cast list.')
          setPhase('error')
          return
        }
        const result = data?.result
        if (!result || !Array.isArray(result.cast)) {
          setError('No cast list could be read from this PDF.')
          setPhase('error')
          return
        }
        // Stage 3 — matching against existing cast.
        setStageIdx(2)
        setProgress(85)
        const p = reconcileCastList(result, existingCast)
        setPlan(p)
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

  // ── Apply ───────────────────────────────────────────────────────────────────
  async function handleApply() {
    setPhase('applying')
    setError(null)
    setProgress(8)
    startCreep(90)
    const res = await onApply(plan)
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

  const s = plan?.summary

  return (
    <div className="sched-import-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sched-import-modal">
        <div className="sched-import-head">
          <h2 className="sched-import-title">Import Cast List from PDF</h2>
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
              <div className="sched-import-dz-text">Drop a cast list PDF here, or click to choose</div>
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
              caption="Writing cast members…"
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
                <span><strong>{s.newCast}</strong> new</span>
                <span><strong>{s.changedCast}</strong> changed</span>
                <span><strong>{s.unchanged}</strong> unchanged</span>
              </div>

              {plan.preview.length === 0 ? (
                <div className="sched-import-dz-sub">No cast members were found in this PDF.</div>
              ) : (
                <div className="cast-import-table">
                  {plan.preview.map((c, i) => (
                    <div
                      key={`${c.castNumber}-${i}`}
                      className={`cast-import-row cast-import-row--${c.status}`}
                    >
                      <StatusBadge status={c.status} />
                      <span className="cast-import-num">{c.castNumber || '—'}</span>
                      <span className="cast-import-name">{c.name || <em>—</em>}</span>
                      <span className="cast-import-role">{c.role || <em>—</em>}</span>
                      {c.status === 'changed' &&
                        ((c.oldName !== c.name) || (c.oldRole !== c.role)) && (
                          <span className="cast-import-was">
                            was: {c.oldName || '—'} / {c.oldRole || '—'}
                          </span>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {phase === 'preview' && (
          <div className="sched-import-foot">
            <button className="pm-btn pm-btn--ghost" onClick={onClose}>Cancel</button>
            <button
              className="pm-btn pm-btn--primary"
              onClick={handleApply}
              disabled={(plan?.castToInsert?.length ?? 0) === 0 && (plan?.castToUpdate?.length ?? 0) === 0}
            >
              Import Cast
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
