import { useState, useRef, useEffect } from 'react'

export default function CostCodeSelect({ value, codes, onChange }) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => { if (open) setSearch('') }, [open])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? codes.filter(c =>
        (c.code || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q))
    : codes

  function pick(code) {
    onChange(code)
    setOpen(false)
  }

  return (
    <div className="cost-code-select" ref={ref}>
      <button
        type="button"
        className={`cost-code-btn${value ? '' : ' is-empty'}`}
        onClick={() => setOpen(o => !o)}
        title={value || 'Set cost code'}
      >
        {value || '—'}
      </button>
      {open && (
        <div className="cost-code-dropdown">
          <input
            className="cost-code-search"
            value={search}
            placeholder="Search codes…"
            autoFocus
            onChange={e => setSearch(e.target.value)}
          />
          <div className="cost-code-list">
            <button
              type="button"
              className="cost-code-item cost-code-clear"
              onClick={() => pick('')}
            >Clear</button>
            {filtered.length === 0 ? (
              <div className="cost-code-empty">
                {codes.length === 0 ? 'No codes — add some in Budget Codes' : 'No matches'}
              </div>
            ) : (
              filtered.map(c => (
                <button
                  type="button"
                  key={c.id}
                  className={`cost-code-item${value === c.code ? ' is-selected' : ''}`}
                  onClick={() => pick(c.code)}
                >
                  <span className="cost-code-item-code">{c.code || '(blank)'}</span>
                  {c.description && <span className="cost-code-item-desc">{c.description}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
