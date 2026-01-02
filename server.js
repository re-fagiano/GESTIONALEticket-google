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
const rawRagUrl = process.env.RAG_API_URL || ''
const RAG_API_URL = rawRagUrl ? rawRagUrl.replace(/\/$/, '') : ''
const API_TOKEN = (process.env.API_TOKEN || '').trim()
const DEFAULT_TOKEN = (process.env.DEFAULT_API_TOKEN || '').trim() || crypto.randomUUID()

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

  if (req.method === 'POST' && url.pathname === '/api/rag') {
    return handleRagProxy(req, res)
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
