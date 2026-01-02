/* eslint-env node */
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const PORT = process.env.PORT || 4173
const rawDeepSeekUrl = process.env.DEEPSEEK_API_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const DEEPSEEK_API_URL = rawDeepSeekUrl.replace(/\/$/, '')
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim()
const API_TOKEN = (process.env.API_TOKEN || process.env.AUTH_TOKEN || '').trim()
const DEFAULT_TOKEN = 'dev-token'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DIST_DIR = path.join(__dirname, 'dist')
const DIST_INDEX = path.join(DIST_DIR, 'index.html')
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'gestionale.db')

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
} else {
  authTokens.add(DEFAULT_TOKEN)
}

const checkAuth = (req) => {
  if (authTokens.size === 0) return true
  const header = req.headers.authorization || ''
  const tokenFromHeader = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const token = tokenFromHeader || req.headers['x-api-token']
  return Boolean(token && authTokens.has(token))
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

const handleApiRequest = async (req, res, url) => {
  const { pathname } = url
  if (pathname === '/api/health' && req.method === 'GET') {
    return respond(res, 200, { ok: true })
  }

  if (pathname === '/api/auth/status' && req.method === 'GET') {
    return respond(res, 200, {
      required: authTokens.size > 0,
      defaultToken: authTokens.has(DEFAULT_TOKEN) ? DEFAULT_TOKEN : null,
    })
  }

  if (pathname === '/api/deepseek' && req.method === 'POST') {
    return handleDeepSeekProxy(req, res)
  }

  if (!checkAuth(req)) {
    return respond(res, 401, { error: 'Token API mancante o non valido.' })
  }

  if (pathname === '/api/bootstrap' && req.method === 'GET') {
    const customers = getAll('SELECT * FROM customers ORDER BY name')
    const tickets = getAll('SELECT * FROM tickets ORDER BY date DESC')
    const inventory = getAll('SELECT * FROM inventory ORDER BY name')
    const settings = getAll('SELECT * FROM settings ORDER BY key')
    return respond(res, 200, {
      customers: customers.map(mapCustomerRow),
      tickets: tickets.map(mapTicketRow),
      inventory: inventory.map(mapInventoryRow),
      settings: settings.map(mapSettingRow),
    })
  }

  if (pathname === '/api/customers' && req.method === 'GET') {
    const rows = getAll('SELECT * FROM customers ORDER BY name')
    return respond(res, 200, rows.map(mapCustomerRow))
  }

  if (pathname === '/api/tickets' && req.method === 'GET') {
    const rows = getAll('SELECT * FROM tickets ORDER BY date DESC')
    return respond(res, 200, rows.map(mapTicketRow))
  }

  if (pathname === '/api/inventory' && req.method === 'GET') {
    const rows = getAll('SELECT * FROM inventory ORDER BY name')
    return respond(res, 200, rows.map(mapInventoryRow))
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    const rows = getAll('SELECT * FROM settings ORDER BY key')
    return respond(res, 200, rows.map(mapSettingRow))
  }

  if (pathname === '/api/customers' && req.method === 'POST') {
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
    }
    const id = ensureId(body.id)
    const existing = getRow('SELECT * FROM customers WHERE id = ?', [id])
    if (existing) {
      return sendConflict(res, 'Cliente già esistente.', mapCustomerRow(existing))
    }
    const now = nowIso()
    runQuery(
      'INSERT INTO customers (id, name, email, phone, address, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        body.name?.trim() || 'Cliente',
        body.email?.trim() || '',
        body.phone?.trim() || '',
        body.address?.trim() || '',
        now,
        now,
        1,
      ],
    )
    const row = getRow('SELECT * FROM customers WHERE id = ?', [id])
    return respond(res, 201, mapCustomerRow(row))
  }

  if (pathname.startsWith('/api/customers/') && req.method === 'PUT') {
    const id = pathname.split('/').pop()
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
    }
    const existing = getRow('SELECT * FROM customers WHERE id = ?', [id])
    if (!existing) {
      const now = nowIso()
      runQuery(
        'INSERT INTO customers (id, name, email, phone, address, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          body.name?.trim() || 'Cliente',
          body.email?.trim() || '',
          body.phone?.trim() || '',
          body.address?.trim() || '',
          now,
          now,
          1,
        ],
      )
      const row = getRow('SELECT * FROM customers WHERE id = ?', [id])
      return respond(res, 201, mapCustomerRow(row))
    }

    const conflict = resolveConflict(existing, body)
    if (conflict) {
      return sendConflict(res, 'Conflitto di aggiornamento cliente.', mapCustomerRow(existing))
    }

    const updatedAt = ensureUpdatedAt(body.updatedAt)
    const version = existing.version + 1
    runQuery(
      'UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, updated_at = ?, version = ? WHERE id = ?',
      [
        body.name?.trim() || existing.name,
        body.email?.trim() || '',
        body.phone?.trim() || '',
        body.address?.trim() || '',
        updatedAt,
        version,
        id,
      ],
    )
    const row = getRow('SELECT * FROM customers WHERE id = ?', [id])
    return respond(res, 200, mapCustomerRow(row))
  }

  if (pathname.startsWith('/api/customers/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop()
    runQuery('DELETE FROM customers WHERE id = ?', [id])
    res.writeHead(204)
    return res.end()
  }

  if (pathname === '/api/tickets' && req.method === 'POST') {
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
    }
    const id = ensureId(body.id)
    const existing = getRow('SELECT * FROM tickets WHERE id = ?', [id])
    if (existing) {
      return sendConflict(res, 'Ticket già esistente.', mapTicketRow(existing))
    }
    const now = nowIso()
    runQuery(
      'INSERT INTO tickets (id, subject, description, customer_id, status, date, time, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        body.subject?.trim() || 'Ticket',
        body.description?.trim() || '',
        body.customerId || '',
        body.status || 'aperto',
        body.date || '',
        body.time || '09:00',
        now,
        now,
        1,
      ],
    )
    const row = getRow('SELECT * FROM tickets WHERE id = ?', [id])
    return respond(res, 201, mapTicketRow(row))
  }

  if (pathname.startsWith('/api/tickets/') && req.method === 'PUT') {
    const id = pathname.split('/').pop()
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
    }
    const existing = getRow('SELECT * FROM tickets WHERE id = ?', [id])
    if (!existing) {
      const now = nowIso()
      runQuery(
        'INSERT INTO tickets (id, subject, description, customer_id, status, date, time, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          body.subject?.trim() || 'Ticket',
          body.description?.trim() || '',
          body.customerId || '',
          body.status || 'aperto',
          body.date || '',
          body.time || '09:00',
          now,
          now,
          1,
        ],
      )
      const row = getRow('SELECT * FROM tickets WHERE id = ?', [id])
      return respond(res, 201, mapTicketRow(row))
    }

    const conflict = resolveConflict(existing, body)
    if (conflict) {
      return sendConflict(res, 'Conflitto di aggiornamento ticket.', mapTicketRow(existing))
    }

    const updatedAt = ensureUpdatedAt(body.updatedAt)
    const version = existing.version + 1
    runQuery(
      'UPDATE tickets SET subject = ?, description = ?, customer_id = ?, status = ?, date = ?, time = ?, updated_at = ?, version = ? WHERE id = ?',
      [
        body.subject?.trim() || existing.subject,
        body.description?.trim() || '',
        body.customerId || '',
        body.status || existing.status,
        body.date || existing.date,
        body.time || existing.time,
        updatedAt,
        version,
        id,
      ],
    )
    const row = getRow('SELECT * FROM tickets WHERE id = ?', [id])
    return respond(res, 200, mapTicketRow(row))
  }

  if (pathname.startsWith('/api/tickets/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop()
    runQuery('DELETE FROM tickets WHERE id = ?', [id])
    res.writeHead(204)
    return res.end()
  }

  if (pathname === '/api/inventory' && req.method === 'POST') {
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
    }
    const id = ensureId(body.id)
    const existing = getRow('SELECT * FROM inventory WHERE id = ?', [id])
    if (existing) {
      return sendConflict(res, 'Elemento di magazzino già esistente.', mapInventoryRow(existing))
    }
    const now = nowIso()
    runQuery(
      'INSERT INTO inventory (id, name, location, qty, price, min_qty, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        body.name?.trim() || 'Ricambio',
        body.location?.trim() || '',
        Number.isFinite(Number(body.qty)) ? Number(body.qty) : 0,
        Number.isFinite(Number(body.price)) ? Number(body.price) : 0,
        Number.isFinite(Number(body.minQty)) ? Number(body.minQty) : 0,
        now,
        now,
        1,
      ],
    )
    const row = getRow('SELECT * FROM inventory WHERE id = ?', [id])
    return respond(res, 201, mapInventoryRow(row))
  }

  if (pathname.startsWith('/api/inventory/') && req.method === 'PUT') {
    const id = pathname.split('/').pop()
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
    }
    const existing = getRow('SELECT * FROM inventory WHERE id = ?', [id])
    if (!existing) {
      const now = nowIso()
      runQuery(
        'INSERT INTO inventory (id, name, location, qty, price, min_qty, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          body.name?.trim() || 'Ricambio',
          body.location?.trim() || '',
          Number.isFinite(Number(body.qty)) ? Number(body.qty) : 0,
          Number.isFinite(Number(body.price)) ? Number(body.price) : 0,
          Number.isFinite(Number(body.minQty)) ? Number(body.minQty) : 0,
          now,
          now,
          1,
        ],
      )
      const row = getRow('SELECT * FROM inventory WHERE id = ?', [id])
      return respond(res, 201, mapInventoryRow(row))
    }

    const conflict = resolveConflict(existing, body)
    if (conflict) {
      return sendConflict(res, 'Conflitto di aggiornamento magazzino.', mapInventoryRow(existing))
    }

    const updatedAt = ensureUpdatedAt(body.updatedAt)
    const version = existing.version + 1
    runQuery(
      'UPDATE inventory SET name = ?, location = ?, qty = ?, price = ?, min_qty = ?, updated_at = ?, version = ? WHERE id = ?',
      [
        body.name?.trim() || existing.name,
        body.location?.trim() || '',
        Number.isFinite(Number(body.qty)) ? Number(body.qty) : existing.qty,
        Number.isFinite(Number(body.price)) ? Number(body.price) : existing.price,
        Number.isFinite(Number(body.minQty)) ? Number(body.minQty) : existing.min_qty,
        updatedAt,
        version,
        id,
      ],
    )
    const row = getRow('SELECT * FROM inventory WHERE id = ?', [id])
    return respond(res, 200, mapInventoryRow(row))
  }

  if (pathname.startsWith('/api/inventory/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop()
    runQuery('DELETE FROM inventory WHERE id = ?', [id])
    res.writeHead(204)
    return res.end()
  }

  if (pathname.startsWith('/api/settings/') && req.method === 'PUT') {
    const key = pathname.split('/').pop()
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
    }
    const existing = getRow('SELECT * FROM settings WHERE key = ?', [key])
    if (!existing) {
      const now = nowIso()
      runQuery(
        'INSERT INTO settings (key, value, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?)',
        [
          key,
          JSON.stringify(body.value ?? ''),
          now,
          now,
          1,
        ],
      )
      const row = getRow('SELECT * FROM settings WHERE key = ?', [key])
      return respond(res, 201, mapSettingRow(row))
    }

    const conflict = resolveConflict(existing, body)
    if (conflict) {
      return sendConflict(res, 'Conflitto di aggiornamento impostazioni.', mapSettingRow(existing))
    }

    const updatedAt = ensureUpdatedAt(body.updatedAt)
    const version = existing.version + 1
    runQuery(
      'UPDATE settings SET value = ?, updated_at = ?, version = ? WHERE key = ?',
      [
        JSON.stringify(body.value ?? existing.value),
        updatedAt,
        version,
        key,
      ],
    )
    const row = getRow('SELECT * FROM settings WHERE key = ?', [key])
    return respond(res, 200, mapSettingRow(row))
  }

  if (pathname === '/api/import' && req.method === 'POST') {
    let body = {}
    try {
      body = await readJsonBody(req)
    } catch (error) {
      return respond(res, error.status || 400, { error: error.message || 'Payload JSON non valido.' })
    }
    const force = Boolean(body.force)
    const customers = Array.isArray(body.customers) ? body.customers : []
    const tickets = Array.isArray(body.tickets) ? body.tickets : []
    const inventory = Array.isArray(body.inventory) ? body.inventory : []
    const settings = Array.isArray(body.settings)
      ? body.settings
      : body.settings && typeof body.settings === 'object'
        ? Object.entries(body.settings).map(([key, value]) => ({ key, value }))
        : []

    const importCollection = (items, config) => {
      const result = { imported: 0, skipped: 0, conflicts: 0 }
      for (const item of items) {
        const incoming = config.mapIncoming(item)
        const id = incoming[config.idField]
        if (!id) continue
        const existing = getRow(`SELECT * FROM ${config.table} WHERE ${config.idField} = ?`, [id])
        if (!existing) {
          runQuery(
            `INSERT INTO ${config.table} (${Object.keys(incoming).join(', ')}) VALUES (${Object.keys(incoming).map(() => '?').join(', ')})`,
            Object.values(incoming),
          )
          result.imported += 1
          continue
        }
        const conflict = !force && resolveConflict(existing, incoming)
        if (conflict) {
          result.conflicts += 1
          result.skipped += 1
          continue
        }
        const updatedValues = { ...incoming, created_at: existing.created_at, version: existing.version + 1 }
        runQuery(
          `UPDATE ${config.table} SET ${Object.keys(updatedValues).map((key) => `${key} = ?`).join(', ')} WHERE ${config.idField} = ?`,
          [...Object.values(updatedValues), id],
        )
        result.imported += 1
      }
      return result
    }

    const customerResult = importCollection(customers, {
      table: 'customers',
      idField: 'id',
      mapIncoming: (item) => ({
        id: ensureId(item.id),
        name: item.name?.trim() || 'Cliente',
        email: item.email?.trim() || '',
        phone: item.phone?.trim() || '',
        address: item.address?.trim() || '',
        created_at: normalizeIso(item.createdAt) || nowIso(),
        updated_at: ensureUpdatedAt(item.updatedAt),
        version: parseVersion(item.version) || 1,
      }),
    })

    const ticketResult = importCollection(tickets, {
      table: 'tickets',
      idField: 'id',
      mapIncoming: (item) => ({
        id: ensureId(item.id),
        subject: item.subject?.trim() || 'Ticket',
        description: item.description?.trim() || '',
        customer_id: item.customerId || '',
        status: item.status || 'aperto',
        date: item.date || '',
        time: item.time || '09:00',
        created_at: normalizeIso(item.createdAt) || nowIso(),
        updated_at: ensureUpdatedAt(item.updatedAt),
        version: parseVersion(item.version) || 1,
      }),
    })

    const inventoryResult = importCollection(inventory, {
      table: 'inventory',
      idField: 'id',
      mapIncoming: (item) => ({
        id: ensureId(item.id),
        name: item.name?.trim() || 'Ricambio',
        location: item.location?.trim() || '',
        qty: Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0,
        price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
        min_qty: Number.isFinite(Number(item.minQty)) ? Number(item.minQty) : 0,
        created_at: normalizeIso(item.createdAt) || nowIso(),
        updated_at: ensureUpdatedAt(item.updatedAt),
        version: parseVersion(item.version) || 1,
      }),
    })

    const settingsResult = importCollection(settings, {
      table: 'settings',
      idField: 'key',
      mapIncoming: (item) => ({
        key: item.key,
        value: JSON.stringify(item.value ?? ''),
        created_at: normalizeIso(item.createdAt) || nowIso(),
        updated_at: ensureUpdatedAt(item.updatedAt),
        version: parseVersion(item.version) || 1,
      }),
    })

    return respond(res, 200, {
      customers: customerResult,
      tickets: ticketResult,
      inventory: inventoryResult,
      settings: settingsResult,
    })
  }

  return respond(res, 404, { error: 'Endpoint non trovato.' })
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
