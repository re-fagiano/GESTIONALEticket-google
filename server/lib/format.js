export const str = (value, fallback = '') => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return fallback
  return value.replace(/\0/g, '').trim()
}

export const strOrNull = (value) => str(value) || null

export const num = (value, fallback = 0) => {
  if (typeof value === 'string') value = value.replace(',', '.').trim()
  if (value === '' || value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const int = (value, fallback = 0) => Math.trunc(num(value, fallback))

export const iso = (value) => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export const dateOr = (value, fallback = new Date()) => {
  const normalized = iso(value)
  return normalized ? new Date(normalized) : fallback
}

// Il vecchio server applicava un escape minimo di < e > in uscita; React fa già l'escape,
// ma manteniamo lo stesso comportamento sui campi di testo libero per compatibilità.
export const escapeAngles = (value) => (typeof value === 'string' ? value.replace(/</g, '&lt;').replace(/>/g, '&gt;') : value ?? '')

export const pickSort = (requested, allowed, fallback) => (allowed[requested] ? allowed[requested] : allowed[fallback])

export const listParams = (query, { allowedSort, defaultSort, maxTake = 100, defaultTake = 20 }) => {
  const q = str(query.q).toLowerCase()
  const sortKey = str(query.sort, defaultSort)
  const sortColumn = allowedSort[sortKey] || allowedSort[defaultSort]
  const order = str(query.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const skip = Math.max(0, int(query.skip, 0))
  const take = Math.min(maxTake, Math.max(1, int(query.take, defaultTake)))
  return { q, sortColumn, order, skip, take }
}

// Divide la ricerca in parole: ogni parola deve comparire in almeno uno dei campi.
export const searchTerms = (q) => str(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)

export const escapeLike = (value) => value.replace(/[\\%_]/g, (match) => `\\${match}`)

export const toCsv = (headers, rows, { separator = ';' } = {}) => {
  const cell = (value) => {
    if (value === null || value === undefined) return ''
    const text = value instanceof Date ? value.toISOString() : String(value)
    return text.includes(separator) || /["\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [headers.map((h) => cell(h.label ?? h.key)).join(separator)]
  for (const row of rows) lines.push(headers.map((h) => cell(typeof h.get === 'function' ? h.get(row) : row[h.key])).join(separator))
  // BOM UTF-8: Excel su Windows riconosce così gli accenti.
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export const parseCsv = (text) => {
  const clean = String(text || '').replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0] || ''
  const separator = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let line = 1
  let rowLine = 1
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') { cell += '"'; i += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === separator) { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i += 1
      row.push(cell); row.line = rowLine; rows.push(row); row = []; cell = ''
      line += 1
      rowLine = line
    } else cell += char
    if (quoted && char === '\n') line += 1
  }
  if (cell || row.length) { row.push(cell); row.line = rowLine; rows.push(row) }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (!nonEmpty.length) return []
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase())
  // Ogni riga ricorda il suo numero nel file (proprietà non enumerabile __line) per i messaggi d'errore.
  return nonEmpty.slice(1).map((r) => Object.defineProperty(
    Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()])),
    '__line', { value: r.line, enumerable: false },
  ))
}
