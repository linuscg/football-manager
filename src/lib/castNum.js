// Cast numbers are free text ("1", "1st", "6bd"): sort by the numeric prefix,
// then the suffix, numbers without a digit prefix last.
export function castNumCompare(a, b) {
  const parse = v => {
    const s = String(v ?? '').trim()
    const m = s.match(/^(\d+)(.*)$/)
    return m ? [parseInt(m[1], 10), m[2]] : [Infinity, s]
  }
  const [an, as] = parse(a)
  const [bn, bs] = parse(b)
  return an - bn || as.localeCompare(bs, undefined, { numeric: true })
}
