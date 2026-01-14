/* eslint-env node */
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'

const {
  PORT,
  DEEPSEEK_API_URL,
  DEEPSEEK_API_KEY,
  RAG_API_URL,
  API_TOKEN,
  DEFAULT_TOKEN,
  NODE_ENV,
  DB_PATH,
} = config

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DIST_DIR = path.join(__dirname, 'dist')
const DIST_INDEX = path.join(DIST_DIR, 'index.html')
const isProduction = NODE_ENV === 'production'

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const nowIso = () => new Date().toISOString()

const normalizeIso = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const ensureId = (value) => (value && typeof value === 'string' ? value : crypto.randomUUID())

const isPathInsideDist = (targetPath) => path.normalize(targetPath).startsWith(path.normalize(DIST_DIR))

const respond = (res, statusCode, payload, headers = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': typeof payload === 'string' ? 'text/plain' : 'application/json',
    ...headers,
  })
  res.end(body)
}

const sendFile = (filePath, res) => {
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType })
  const stream = createReadStream(filePath)
  stream.on('error', () => {
    respond(res, 500, { error: 'Errore durante la lettura del file.' })
  })
  stream.pipe(res)
}

const readJsonBody = async (req) => {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch (error) {
    const err = new Error('Payload JSON non valido.')
    err.status = 400
    throw err
  }
}

const parseCookies = (cookieHeader = '') => {
  if (!cookieHeader) return {}
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=')
    if (!key) return acc
    acc[key] = decodeURIComponent(rest.join('='))
    return acc
  }, {})
}

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  return value.replace(/\0/g, '').trim()
}

const sanitizeNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isEmpty = (value) => value === null || value === undefined || value === ''

const validateCustomerPayload = (payload) => {
  const name = sanitizeString(payload?.name)
  if (!name) return { error: 'Il nome cliente è obbligatorio.' }
  return {
    value: {
      id: ensureId(payload?.id),
      name,
      email: sanitizeString(payload?.email),
      phone: sanitizeString(payload?.phone),
      address: sanitizeString(payload?.address),
      updatedAt: ensureUpdatedAt(payload?.updatedAt),
      version: sanitizeNumber(payload?.version, 1),
    },
  }
}

const validateTicketPayload = (payload) => {
  const subject = sanitizeString(payload?.subject)
  if (!subject) return { error: 'Oggetto ticket obbligatorio.' }
  return {
    value: {
      id: ensureId(payload?.id),
      subject,
      description: sanitizeString(payload?.description),
      customerId: sanitizeString(payload?.customerId),
      status: sanitizeString(payload?.status, 'aperto'),
      date: sanitizeString(payload?.date),
      time: sanitizeString(payload?.time),
      updatedAt: ensureUpdatedAt(payload?.updatedAt),
      version: sanitizeNumber(payload?.version, 1),
    },
  }
}

const validateInventoryPayload = (payload) => {
  const name = sanitizeString(payload?.name)
  if (!name) return { error: 'Nome ricambio obbligatorio.' }
  return {
    value: {
      id: ensureId(payload?.id),
      name,
      location: sanitizeString(payload?.location),
      qty: sanitizeNumber(payload?.qty, 0),
      price: sanitizeNumber(payload?.price, 0),
      minQty: sanitizeNumber(payload?.minQty, 0),
      updatedAt: ensureUpdatedAt(payload?.updatedAt),
      version: sanitizeNumber(payload?.version, 1),
    },
  }
}

const mapCustomerRow = (row) => (row ? ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  address: row.address,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
}) : null)

const mapTicketRow = (row) => (row ? ({
  id: row.id,
  subject: row.subject,
  description: row.description,
  customerId: row.customer_id,
  status: row.status,
  date: row.date,
  time: row.time,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
}) : null)

const mapInventoryRow = (row) => (row ? ({
  id: row.id,
  name: row.name,
  location: row.location,
  qty: row.qty,
  price: row.price,
  minQty: row.min_qty,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
}) : null)

const mapSettingRow = (row) => (row ? ({
  key: row.key,
  value: (() => {
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  })(),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
}) : null)

const authTokens = new Set()
if (API_TOKEN) {
  authTokens.add(API_TOKEN)
} else if (!isProduction) {
  authTokens.add(DEFAULT_TOKEN)
}

const checkAuth = (req) => {
  if (isProduction && !API_TOKEN) return false
  if (authTokens.size === 0) return true
  const header = req.headers.authorization || ''
  const tokenFromHeader = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const cookies = parseCookies(req.headers.cookie)
  const tokenFromCookie = cookies.api_token
  const token = tokenFromHeader || req.headers['x-api-token'] || tokenFromCookie
  return Boolean(token && authTokens.has(token))
}

const issueToken = () => {
  const token = crypto.randomUUID()
  authTokens.add(token)
  return token
}

const maskToken = (token) => {
  if (!token) return ''
  return `${token.slice(0, 4)}••••${token.slice(-4)}`
}

const sendUnauthorized = (res) => {
  respond(res, 401, { error: 'Token API mancante o non valido.' })
}

const setAuthCookie = (res, token) => {
  const cookie = `api_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
  res.setHeader('Set-Cookie', cookie)
}

const rateLimits = new Map()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 120

const checkRateLimit = (req, res) => {
  const ip = req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const entry = rateLimits.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
  if (now > entry.resetAt) {
    entry.count = 0
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS
  }
  entry.count += 1
  rateLimits.set(ip, entry)
  if (entry.count > RATE_LIMIT_MAX) {
    respond(res, 429, { error: 'Troppe richieste, riprova più tardi.' })
    return false
  }
  return true
}

await mkdir(path.dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    description TEXT,
    customer_id TEXT,
    status TEXT,
    date TEXT,
    time TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT,
    qty INTEGER,
    price REAL,
    min_qty INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL
  );
`)

const getRow = (sql, params = []) => db.prepare(sql).get(...params)
const getAll = (sql, params = []) => db.prepare(sql).all(...params)
const runQuery = (sql, params = []) => db.prepare(sql).run(...params)

const parseVersion = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const ensureUpdatedAt = (value) => normalizeIso(value) || nowIso()

const resolveConflict = (existing, incoming) => {
  const incomingVersion = parseVersion(incoming.version)
  const incomingUpdatedAt = normalizeIso(incoming.updatedAt)
  const existingUpdatedAt = normalizeIso(existing.updated_at)

  if (incomingVersion !== null && incomingVersion !== existing.version) {
    return 'version'
  }
  if (incomingUpdatedAt && existingUpdatedAt && incomingUpdatedAt < existingUpdatedAt) {
    return 'timestamp'
  }
  return null
}

const sendConflict = (res, message, current) => {
  respond(res, 409, { error: message, current })
}

const parseCsv = (csvText) => {
  if (!csvText) return []
  const lines = csvText.split(/\r?\n/).filter(Boolean)
  const rows = []
  let headers = []
  lines.forEach((line, index) => {
    const delimiter = line.includes(';') && !line.includes(',') ? ';' : ','
    const columns = line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ''))
    if (index === 0) {
      headers = columns.map((value) => value.toLowerCase())
      return
    }
    const row = {}
    headers.forEach((header, idx) => {
      row[header] = columns[idx] ?? ''
    })
    rows.push(row)
  })
  return rows
}

const parseMultipart = async (req) => {
  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=([^;]+)/)
  if (!boundaryMatch) return { fields: {}, files: [] }
  const boundary = `--${boundaryMatch[1]}`
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  const parts = body.split(boundary).filter((part) => part.trim() && part.trim() !== '--')
  const fields = {}
  const files = []
  parts.forEach((part) => {
    const [rawHeaders, ...rest] = part.split('\r\n\r\n')
    const content = rest.join('\r\n\r\n').replace(/\r\n--$/, '').trim()
    const headerLines = rawHeaders.split('\r\n').filter(Boolean)
    const disposition = headerLines.find((line) => line.toLowerCase().startsWith('content-disposition'))
    if (!disposition) return
    const nameMatch = disposition.match(/name="([^"]+)"/)
    const fileMatch = disposition.match(/filename="([^"]+)"/)
    const fieldName = nameMatch ? nameMatch[1] : null
    if (!fieldName) return
    if (fileMatch) {
      files.push({ fieldName, filename: fileMatch[1], content })
    } else {
      fields[fieldName] = content
    }
  })
  return { fields, files }
}

const readCsvFile = (file) => {
  const content = typeof file?.content === 'string' ? file.content : ''
  return parseCsv(content)
}

const ensureAuth = (req, res) => {
  if (!checkAuth(req)) {
    sendUnauthorized(res)
    return false
  }
  return true
}

const handleApiRequest = async (req, res, url) => {
  if (!checkRateLimit(req, res)) return

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return respond(res, 200, { status: 'ok', time: nowIso() })
  }

  if (url.pathname === '/api/deepseek' && req.method === 'POST') {
    return handleDeepSeekProxy(req, res)
  }

  if (url.pathname === '/api/rag' && req.method === 'POST') {
    return handleRagProxy(req, res)
  }

  if (url.pathname === '/api/token' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const token = sanitizeString(payload?.token)
      if (!token || !authTokens.has(token)) {
        return respond(res, 401, { error: 'Token non valido.' })
      }
      setAuthCookie(res, token)
      return respond(res, 200, { maskedToken: maskToken(token) })
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload non valido.' })
    }
  }

  if (url.pathname === '/api/token' && req.method === 'GET') {
    if (!ensureAuth(req, res)) return
    const token = issueToken()
    setAuthCookie(res, token)
    return respond(res, 200, { token, maskedToken: maskToken(token) })
  }

  if (url.pathname === '/api/token/status' && req.method === 'GET') {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies.api_token
    if (token && authTokens.has(token)) {
      return respond(res, 200, { maskedToken: maskToken(token) })
    }
    return respond(res, 204, '')
  }

  if (!url.pathname.startsWith('/api/')) {
    return respond(res, 404, { error: 'Endpoint non valido.' })
  }

  if (!ensureAuth(req, res)) return

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    return respond(res, 200, {
      customers: getAll('SELECT * FROM customers').map(mapCustomerRow),
      tickets: getAll('SELECT * FROM tickets').map(mapTicketRow),
      inventory: getAll('SELECT * FROM inventory').map(mapInventoryRow),
      settings: getAll('SELECT * FROM settings').map(mapSettingRow),
    })
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    try {
      const payload = await readJsonBody(req)
      const customers = Array.isArray(payload?.customers) ? payload.customers : []
      const tickets = Array.isArray(payload?.tickets) ? payload.tickets : []
      const inventory = Array.isArray(payload?.inventory) ? payload.inventory : []
      const settings = Array.isArray(payload?.settings) ? payload.settings : []
      db.exec('BEGIN')
      runQuery('DELETE FROM customers')
      runQuery('DELETE FROM tickets')
      runQuery('DELETE FROM inventory')
      runQuery('DELETE FROM settings')
      customers.forEach((customer, idx) => {
        const { error, value } = validateCustomerPayload(customer)
        if (error) throw new Error(error)
        runQuery(
          'INSERT INTO customers (id, name, email, phone, address, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.name, value.email, value.phone, value.address, nowIso(), value.updatedAt, value.version || 1],
        )
      })
      tickets.forEach((ticket) => {
        const { error, value } = validateTicketPayload(ticket)
        if (error) throw new Error(error)
        runQuery(
          'INSERT INTO tickets (id, subject, description, customer_id, status, date, time, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.subject, value.description, value.customerId, value.status, value.date, value.time, nowIso(), value.updatedAt, value.version || 1],
        )
      })
      inventory.forEach((item) => {
        const { error, value } = validateInventoryPayload(item)
        if (error) throw new Error(error)
        runQuery(
          'INSERT INTO inventory (id, name, location, qty, price, min_qty, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.name, value.location, value.qty, value.price, value.minQty, nowIso(), value.updatedAt, value.version || 1],
        )
      })
      settings.forEach((setting) => {
        if (isEmpty(setting?.key)) return
        runQuery(
          'INSERT INTO settings (key, value, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?)',
          [
            sanitizeString(setting.key),
            JSON.stringify(setting.value ?? null),
            nowIso(),
            ensureUpdatedAt(setting.updatedAt),
            sanitizeNumber(setting.version, 1),
          ],
        )
      })
      db.exec('COMMIT')
      return respond(res, 200, { status: 'ok' })
    } catch (error) {
      db.exec('ROLLBACK')
      return respond(res, 400, { error: error.message || 'Errore import.' })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/import/excel') {
    const { files } = await parseMultipart(req)
    const file = files.find((entry) => entry.fieldName === 'file')
    if (!file) {
      return respond(res, 400, { error: 'File mancante.' })
    }
    if (file.filename && file.filename.toLowerCase().endsWith('.xlsx')) {
      return respond(res, 400, { error: 'Formato XLSX non supportato nel server attuale. Esporta in CSV.' })
    }
    const rows = readCsvFile(file)
    if (!rows.length) {
      return respond(res, 400, { error: 'File CSV vuoto o non valido.' })
    }
    const updatedItems = []
    rows.forEach((row) => {
      const payload = {
        id: row.id || row.codice || row.sku,
        name: row.name || row.prodotto || row.nome,
        location: row.location || row.posizione || '',
        qty: row.qty || row.quantita || 0,
        price: row.price || row.prezzo || 0,
        minQty: row.minqty || row.soglia || 0,
      }
      const { error, value } = validateInventoryPayload(payload)
      if (error) return
      const existing = getRow('SELECT * FROM inventory WHERE id = ?', [value.id])
      if (existing) {
        const newQty = sanitizeNumber(existing.qty, 0) + sanitizeNumber(value.qty, 0)
        runQuery(
          'UPDATE inventory SET name = ?, location = ?, qty = ?, price = ?, min_qty = ?, updated_at = ?, version = ? WHERE id = ?',
          [
            value.name,
            value.location,
            newQty,
            value.price,
            value.minQty,
            nowIso(),
            existing.version + 1,
            value.id,
          ],
        )
        updatedItems.push(mapInventoryRow(getRow('SELECT * FROM inventory WHERE id = ?', [value.id])))
      } else {
        runQuery(
          'INSERT INTO inventory (id, name, location, qty, price, min_qty, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.name, value.location, value.qty, value.price, value.minQty, nowIso(), value.updatedAt, 1],
        )
        updatedItems.push(mapInventoryRow(getRow('SELECT * FROM inventory WHERE id = ?', [value.id])))
      }
    })
    return respond(res, 200, { items: updatedItems })
  }

  if (req.method === 'GET' && url.pathname === '/api/import/template') {
    const csv = 'id,name,location,qty,price,minQty\nSKU123,Guarnizione pompa,AF-01-A,3,12.5,1\n'
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="template_magazzino.csv"',
    })
    return res.end(csv)
  }

  const match = (pattern) => {
    const result = url.pathname.match(pattern)
    return result ? result[1] : null
  }

  if (req.method === 'GET' && url.pathname === '/api/customers') {
    return respond(res, 200, getAll('SELECT * FROM customers').map(mapCustomerRow))
  }
  if (req.method === 'POST' && url.pathname === '/api/customers') {
    const payload = await readJsonBody(req)
    const { error, value } = validateCustomerPayload(payload)
    if (error) return respond(res, 400, { error })
    runQuery(
      'INSERT INTO customers (id, name, email, phone, address, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.name, value.email, value.phone, value.address, nowIso(), value.updatedAt, 1],
    )
    return respond(res, 201, mapCustomerRow(getRow('SELECT * FROM customers WHERE id = ?', [value.id])))
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/api/customers/')) {
    const id = match(/^\/api\/customers\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Cliente non trovato.' })
    const payload = await readJsonBody(req)
    const { error, value } = validateCustomerPayload({ ...payload, id })
    if (error) return respond(res, 400, { error })
    const existing = getRow('SELECT * FROM customers WHERE id = ?', [id])
    if (!existing) return respond(res, 404, { error: 'Cliente non trovato.' })
    const conflictReason = resolveConflict(existing, value)
    if (conflictReason) {
      return sendConflict(res, 'Conflitto cliente: aggiorna i dati.', mapCustomerRow(existing))
    }
    runQuery(
      'UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.name, value.email, value.phone, value.address, value.updatedAt, existing.version + 1, id],
    )
    return respond(res, 200, mapCustomerRow(getRow('SELECT * FROM customers WHERE id = ?', [id])))
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/customers/')) {
    const id = match(/^\/api\/customers\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Cliente non trovato.' })
    runQuery('DELETE FROM customers WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  if (req.method === 'GET' && url.pathname === '/api/tickets') {
    return respond(res, 200, getAll('SELECT * FROM tickets').map(mapTicketRow))
  }
  if (req.method === 'POST' && url.pathname === '/api/tickets') {
    const payload = await readJsonBody(req)
    const { error, value } = validateTicketPayload(payload)
    if (error) return respond(res, 400, { error })
    runQuery(
      'INSERT INTO tickets (id, subject, description, customer_id, status, date, time, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.subject, value.description, value.customerId, value.status, value.date, value.time, nowIso(), value.updatedAt, 1],
    )
    return respond(res, 201, mapTicketRow(getRow('SELECT * FROM tickets WHERE id = ?', [value.id])))
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/api/tickets/')) {
    const id = match(/^\/api\/tickets\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Ticket non trovato.' })
    const payload = await readJsonBody(req)
    const { error, value } = validateTicketPayload({ ...payload, id })
    if (error) return respond(res, 400, { error })
    const existing = getRow('SELECT * FROM tickets WHERE id = ?', [id])
    if (!existing) return respond(res, 404, { error: 'Ticket non trovato.' })
    const conflictReason = resolveConflict(existing, value)
    if (conflictReason) {
      return sendConflict(res, 'Conflitto ticket: aggiorna i dati.', mapTicketRow(existing))
    }
    runQuery(
      'UPDATE tickets SET subject = ?, description = ?, customer_id = ?, status = ?, date = ?, time = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.subject, value.description, value.customerId, value.status, value.date, value.time, value.updatedAt, existing.version + 1, id],
    )
    return respond(res, 200, mapTicketRow(getRow('SELECT * FROM tickets WHERE id = ?', [id])))
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/tickets/')) {
    const id = match(/^\/api\/tickets\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Ticket non trovato.' })
    runQuery('DELETE FROM tickets WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  if (req.method === 'GET' && url.pathname === '/api/inventory') {
    return respond(res, 200, getAll('SELECT * FROM inventory').map(mapInventoryRow))
  }
  if (req.method === 'POST' && url.pathname === '/api/inventory') {
    const payload = await readJsonBody(req)
    const { error, value } = validateInventoryPayload(payload)
    if (error) return respond(res, 400, { error })
    runQuery(
      'INSERT INTO inventory (id, name, location, qty, price, min_qty, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.name, value.location, value.qty, value.price, value.minQty, nowIso(), value.updatedAt, 1],
    )
    return respond(res, 201, mapInventoryRow(getRow('SELECT * FROM inventory WHERE id = ?', [value.id])))
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/api/inventory/')) {
    const id = match(/^\/api\/inventory\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Ricambio non trovato.' })
    const payload = await readJsonBody(req)
    const { error, value } = validateInventoryPayload({ ...payload, id })
    if (error) return respond(res, 400, { error })
    const existing = getRow('SELECT * FROM inventory WHERE id = ?', [id])
    if (!existing) return respond(res, 404, { error: 'Ricambio non trovato.' })
    const conflictReason = resolveConflict(existing, value)
    if (conflictReason) {
      return sendConflict(res, 'Conflitto magazzino: aggiorna i dati.', mapInventoryRow(existing))
    }
    runQuery(
      'UPDATE inventory SET name = ?, location = ?, qty = ?, price = ?, min_qty = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.name, value.location, value.qty, value.price, value.minQty, value.updatedAt, existing.version + 1, id],
    )
    return respond(res, 200, mapInventoryRow(getRow('SELECT * FROM inventory WHERE id = ?', [id])))
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/inventory/')) {
    const id = match(/^\/api\/inventory\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Ricambio non trovato.' })
    runQuery('DELETE FROM inventory WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  return respond(res, 404, { error: 'Endpoint non trovato.' })
}

const handleDeepSeekProxy = async (req, res) => {
  if (!DEEPSEEK_API_KEY) {
    return respond(res, 500, { error: 'DEEPSEEK_API_KEY non configurata lato server.' })
  }

  let payload = {}
  try {
    payload = await readJsonBody(req)
  } catch (error) {
    return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
  }

  try {
    const upstream = `${DEEPSEEK_API_URL}/chat/completions`
    const response = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    let parsed = text
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }

    respond(res, response.status, parsed)
  } catch (error) {
    respond(res, 502, { error: error?.message || 'Errore durante la chiamata a DeepSeek.' })
  }
}

const handleRagProxy = async (req, res) => {
  if (!RAG_API_URL) {
    return respond(res, 500, { error: 'RAG_API_URL non configurata lato server.' })
  }

  let body = ''
  for await (const chunk of req) {
    body += chunk
  }

  let payload = {}
  if (body) {
    try {
      payload = JSON.parse(body)
    } catch (error) {
      return respond(res, 400, { error: 'Payload JSON non valido.' })
    }
  }

  try {
    const response = await fetch(RAG_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    let parsed = text
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }

    respond(res, response.status, parsed)
  } catch (error) {
    respond(res, 502, { error: error?.message || 'Errore durante la chiamata RAG.' })
  }
}

const handleStaticRequest = async (pathname, res) => {
  const decodedPath = decodeURIComponent(pathname)
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '')
  const absolutePath = path.join(DIST_DIR, safePath)

  if (!isPathInsideDist(absolutePath)) {
    return respond(res, 400, { error: 'Percorso non valido.' })
  }

  try {
    const fileStat = await stat(absolutePath)
    if (fileStat.isFile()) {
      return sendFile(absolutePath, res)
    }
  } catch {
    // fallthrough to SPA fallback or 404
  }

  const isAsset = decodedPath.startsWith('/assets/')
  if (isAsset) {
    return respond(res, 404, { error: 'Risorsa non trovata.' })
  }

  try {
    await access(DIST_INDEX)
    return sendFile(DIST_INDEX, res)
  } catch {
    return respond(res, 500, { error: 'File index.html non trovato.' })
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname.startsWith('/api/')) {
    return handleApiRequest(req, res, url)
  }

  if (req.method === 'GET') {
    return handleStaticRequest(url.pathname, res)
  }

  return respond(res, 405, { error: 'Metodo non supportato.' })
})

server.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`)
  if (authTokens.has(DEFAULT_TOKEN)) {
    console.log(`Token API di default: ${DEFAULT_TOKEN}`)
  }
})
