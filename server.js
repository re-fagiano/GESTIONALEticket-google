/* eslint-env node */
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'
import prisma, { isDatabaseConfigured } from './src/db/prisma.js'

const {
  PORT,
  DEEPSEEK_API_URL,
  DEEPSEEK_API_KEY,
  RAG_API_URL,
  API_TOKEN,
  DEFAULT_TOKEN,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  ADMIN_USER,
  ADMIN_PASS,
  NODE_ENV,
  DB_PATH,
  DATABASE_URL,
  BACKUP_INTERVAL_HOURS,
  GOOGLE_DRIVE_FOLDER_NAME,
  GOOGLE_DRIVE_FOLDER_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64,
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

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
}

const logEvent = (level, message, context = {}) => {
  const entry = {
    ts: nowIso(),
    level,
    message,
    ...context,
  }
  const output = JSON.stringify(entry)
  if (level === 'error') {
    console.error(output)
  } else if (level === 'warn') {
    console.warn(output)
  } else {
    console.log(output)
  }
}

if (!DATABASE_URL) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: 'database_url_missing', detail: 'DATABASE_URL non configurata: backend in fallback SQLite.' }))
}

const createHttpError = (status, message, code = 'request_error') => {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

const handleErrorResponse = (res, error, context = {}) => {
  const status = Number.isInteger(error?.status) ? error.status : 500
  const message = error?.message || 'Errore interno del server.'
  logEvent(status >= 500 ? 'error' : 'warn', 'request_failed', {
    status,
    code: error?.code || 'internal_error',
    error: message,
    ...context,
  })
  if (!res.headersSent) {
    respond(res, status, { error: message, code: error?.code || 'internal_error' })
  } else {
    res.end()
  }
}

const nowIso = () => new Date().toISOString()

const normalizeIso = (value) => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}


const ensureDate = (value) => {
  const normalized = normalizeIso(value)
  return normalized ? new Date(normalized) : new Date()
}

const interventionCode = () => {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const suffix = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `INV-${y}${m}${day}-${suffix}`
}

const mapPrismaIntervention = (row) => {
  if (!row) return null
  const openedTime = row.openedAt ? new Date(row.openedAt).getTime() : null
  const closedTime = row.closedAt ? new Date(row.closedAt).getTime() : Date.now()
  const durationDays = (openedTime && Number.isFinite(closedTime))
    ? Math.max(0, Math.ceil((closedTime - openedTime) / 86_400_000))
    : 0
  return {
    id: row.id,
    code: row.code,
    clientId: row.customerId,
    customerId: row.customerId,
    type: row.type,
    status: row.status,
    urgency: row.priority,
    priority: row.priority,
    assignedTo: row.assignedTo,
    openedAt: row.openedAt?.toISOString?.() || row.openedAt,
    closedAt: row.closedAt?.toISOString?.() || row.closedAt,
    description: row.description || '',
    additionalData: row.additionalData || {},
    durationDays,
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt,
    version: row.version,
  }
}

const ensureId = (value) => (value && typeof value === 'string' ? value : crypto.randomUUID())

const isPathInsideDist = (targetPath) => path.normalize(targetPath).startsWith(path.normalize(DIST_DIR))

const respond = (res, statusCode, payload, headers = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': typeof payload === 'string' ? 'text/plain' : 'application/json',
    ...SECURITY_HEADERS,
    ...headers,
  })
  res.end(body)
}

const sendFile = (filePath, res) => {
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType, ...SECURITY_HEADERS })
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
  } catch {
    throw createHttpError(400, 'Payload JSON non valido.', 'invalid_json')
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

const parseListQuery = (url, { defaultSort = 'created_at', allowedSort = [] } = {}) => {
  const q = sanitizeString(url.searchParams.get('q')).toLowerCase()
  const sort = sanitizeString(url.searchParams.get('sort'), defaultSort)
  const order = sanitizeString(url.searchParams.get('order'), 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const skip = Math.max(0, sanitizeNumber(url.searchParams.get('skip'), 0))
  const take = Math.min(100, Math.max(1, sanitizeNumber(url.searchParams.get('take'), 20)))
  const sortColumn = allowedSort.includes(sort) ? sort : defaultSort
  return { q, sortColumn, order, skip, take }
}

const validators = {
  requiredString: (value, errorMessage) => {
    const normalized = sanitizeString(value)
    if (!normalized) return { error: errorMessage }
    return { value: normalized }
  },
  enumValue: (value, allowedValues, fallback, errorMessage) => {
    const normalized = sanitizeString(value, fallback)
    if (!allowedValues.has(normalized)) return { error: errorMessage }
    return { value: normalized }
  },
}

const INTERVENTION_TYPES = new Set(['chiamata', 'riparazione', 'ordine_ricambi', 'preventivo'])
const INTERVENTION_STATUSES = new Set(['pendente', 'preso_in_carico', 'diagnosticato', 'ordine_ricambi', 'preventivato', 'saldato', 'chiuso'])
const URGENCY_LEVELS = new Set([1, 2, 3])
const SPARE_PART_ORDER_STATUSES = new Set(['ordinato', 'in_arrivo', 'arrivato', 'consegnato'])
const QUOTE_STATUSES = new Set(['proposto', 'accettato', 'rifiutato'])


const INTERVENTION_TYPE_TO_DB = {
  chiamata: 'CALL_OUT',
  riparazione: 'LAB_REPAIR',
  ordine_ricambi: 'SPARE_PART_ORDER',
  preventivo: 'NEW_APPLIANCE_QUOTE',
}

const INTERVENTION_TYPE_FROM_DB = Object.fromEntries(Object.entries(INTERVENTION_TYPE_TO_DB).map(([k,v]) => [v,k]))

const INTERVENTION_STATUS_TO_DB = {
  pendente: 'OPEN',
  preso_in_carico: 'IN_PROGRESS',
  diagnosticato: 'IN_PROGRESS',
  ordine_ricambi: 'WAITING_PARTS',
  preventivato: 'WAITING_CUSTOMER',
  saldato: 'DONE',
  chiuso: 'DONE',
}

const INTERVENTION_STATUS_FROM_DB = {
  OPEN: 'pendente',
  IN_PROGRESS: 'preso_in_carico',
  WAITING_PARTS: 'ordine_ricambi',
  WAITING_CUSTOMER: 'preventivato',
  DONE: 'chiuso',
  CANCELED: 'chiuso',
}

const isEmpty = (value) => value === null || value === undefined || value === ''

const validateCustomerPayload = (payload) => {
  const nameValidation = validators.requiredString(payload?.name, 'Il nome cliente è obbligatorio.')
  if (nameValidation.error) return nameValidation
  return {
    value: {
      id: ensureId(payload?.id),
      name: nameValidation.value,
      email: sanitizeString(payload?.email),
      phone: sanitizeString(payload?.phone),
      address: sanitizeString(payload?.address),
      updatedAt: ensureUpdatedAt(payload?.updatedAt),
      version: sanitizeNumber(payload?.version, 1),
    },
  }
}

const validateTicketPayload = (payload) => {
  const subjectValidation = validators.requiredString(payload?.subject, 'Oggetto ticket obbligatorio.')
  if (subjectValidation.error) return subjectValidation
  return {
    value: {
      id: ensureId(payload?.id),
      subject: subjectValidation.value,
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
  const nameValidation = validators.requiredString(payload?.name, 'Nome ricambio obbligatorio.')
  if (nameValidation.error) return nameValidation
  return {
    value: {
      id: ensureId(payload?.id),
      name: nameValidation.value,
      location: sanitizeString(payload?.location),
      qty: sanitizeNumber(payload?.qty, 0),
      price: sanitizeNumber(payload?.price, 0),
      minQty: sanitizeNumber(payload?.minQty, 0),
      priceDate: sanitizeString(payload?.priceDate),
      updatedAt: ensureUpdatedAt(payload?.updatedAt),
      version: sanitizeNumber(payload?.version, 1),
    },
  }
}

const validateInterventionPayload = (payload) => {
  const clientIdValidation = validators.requiredString(payload?.clientId || payload?.customerId, 'Il client_id è obbligatorio.')
  if (clientIdValidation.error) return clientIdValidation
  const typeValidation = validators.enumValue(payload?.type, INTERVENTION_TYPES, '', 'Tipo intervento non valido.')
  if (typeValidation.error) return typeValidation
  const statusValidation = validators.enumValue(payload?.status, INTERVENTION_STATUSES, 'pendente', 'Stato intervento non valido.')
  if (statusValidation.error) return statusValidation

  const urgency = sanitizeNumber(payload?.urgency, 2)
  if (!URGENCY_LEVELS.has(urgency)) return { error: 'Urgenza non valida (1, 2, 3).' }

  const parsedAdditionalData = payload?.additionalData && typeof payload.additionalData === 'object'
    ? payload.additionalData
    : {}

  return {
    value: {
      id: ensureId(payload?.id),
      clientId: clientIdValidation.value,
      type: typeValidation.value,
      status: statusValidation.value,
      urgency,
      openedAt: normalizeIso(payload?.openedAt) || nowIso(),
      closedAt: normalizeIso(payload?.closedAt),
      description: sanitizeString(payload?.description),
      parentInterventionId: sanitizeString(payload?.parentInterventionId) || null,
      additionalData: JSON.stringify(parsedAdditionalData),
      updatedAt: ensureUpdatedAt(payload?.updatedAt),
      version: sanitizeNumber(payload?.version, 1),
    },
  }
}

const validateSparePartOrderPayload = (payload) => {
  const interventionValidation = validators.requiredString(payload?.interventionId, 'intervention_id obbligatorio.')
  if (interventionValidation.error) return interventionValidation
  const statusValidation = validators.enumValue(payload?.status, SPARE_PART_ORDER_STATUSES, 'ordinato', 'Stato ordine ricambi non valido.')
  if (statusValidation.error) return statusValidation
  return {
    value: {
      id: ensureId(payload?.id),
      interventionId: interventionValidation.value,
      parts: JSON.stringify(Array.isArray(payload?.parts) ? payload.parts : []),
      status: statusValidation.value,
      supplier: sanitizeString(payload?.supplier),
      notes: sanitizeString(payload?.notes),
      updatedAt: ensureUpdatedAt(payload?.updatedAt),
      version: sanitizeNumber(payload?.version, 1),
    },
  }
}

const validateQuotePayload = (payload) => {
  const interventionValidation = validators.requiredString(payload?.interventionId, 'intervention_id obbligatorio.')
  if (interventionValidation.error) return interventionValidation
  const statusValidation = validators.enumValue(payload?.status, QUOTE_STATUSES, 'proposto', 'Stato preventivo non valido.')
  if (statusValidation.error) return statusValidation
  return {
    value: {
      id: ensureId(payload?.id),
      interventionId: interventionValidation.value,
      items: JSON.stringify(Array.isArray(payload?.items) ? payload.items : []),
      totalAmount: sanitizeNumber(payload?.totalAmount, 0),
      discount: sanitizeNumber(payload?.discount, 0),
      validUntil: normalizeIso(payload?.validUntil),
      status: statusValidation.value,
      notes: sanitizeString(payload?.notes),
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
  priceDate: row.price_date || '',
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

const mapInterventionRow = (row) => {
  if (!row) return null
  const openedTime = row.opened_at ? new Date(row.opened_at).getTime() : null
  const closedTime = row.closed_at ? new Date(row.closed_at).getTime() : Date.now()
  const durationDays = (openedTime && Number.isFinite(closedTime))
    ? Math.max(0, Math.ceil((closedTime - openedTime) / 86_400_000))
    : 0
  return {
    id: row.id,
    clientId: row.client_id,
    type: row.type,
    status: row.status,
    urgency: row.urgency,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    description: row.description,
    parentInterventionId: row.parent_intervention_id,
    additionalData: (() => {
      try {
        return row.additional_data ? JSON.parse(row.additional_data) : {}
      } catch {
        return {}
      }
    })(),
    durationDays,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

const mapSparePartOrderRow = (row) => (row ? ({
  id: row.id,
  interventionId: row.intervention_id,
  parts: (() => {
    try {
      return row.parts ? JSON.parse(row.parts) : []
    } catch {
      return []
    }
  })(),
  status: row.status,
  supplier: row.supplier,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
}) : null)

const mapQuoteRow = (row) => (row ? ({
  id: row.id,
  interventionId: row.intervention_id,
  items: (() => {
    try {
      return row.items ? JSON.parse(row.items) : []
    } catch {
      return []
    }
  })(),
  totalAmount: row.total_amount,
  discount: row.discount,
  validUntil: row.valid_until,
  status: row.status,
  notes: row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
}) : null)

const USER_ROLES = new Set(['admin', 'tech', 'read', 'operator'])
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const toBase64Url = (value) => Buffer.from(value).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const hashValue = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(String(password || ''), salt, 64)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

const verifyPassword = (password, storedHash) => {
  if (!storedHash || typeof storedHash !== 'string') return false
  if (!storedHash.startsWith('scrypt$')) {
    const legacy = hashValue(password)
    return crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(legacy))
  }
  const [, saltHex, keyHex] = storedHash.split('$')
  if (!saltHex || !keyHex) return false
  const computed = crypto.scryptSync(String(password || ''), Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(keyHex, 'hex')
  if (computed.length !== expected.length) return false
  return crypto.timingSafeEqual(computed, expected)
}

const normalizeEmail = (value) => sanitizeString(value).toLowerCase()

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const signJwt = (payload, secret, expiresInSeconds) => {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + expiresInSeconds }
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode(header)}.${encode(body)}`
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

const verifyJwt = (token, secret) => {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, body, signature] = parts
  const expected = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  if (signature !== expected) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!payload?.exp || Math.floor(Date.now() / 1000) > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

const createAuthTokens = (user) => {
  const accessToken = signJwt({ sub: user.id, role: user.role, type: 'access' }, JWT_ACCESS_SECRET, ACCESS_TOKEN_TTL_SECONDS)
  const refreshId = crypto.randomUUID()
  const refreshToken = signJwt({ sub: user.id, role: user.role, type: 'refresh', jti: refreshId }, JWT_REFRESH_SECRET, REFRESH_TOKEN_TTL_SECONDS)
  const csrfToken = toBase64Url(crypto.randomBytes(32))
  return { accessToken, refreshToken, refreshId, csrfToken }
}

const getTokenFromRequest = (req) => {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  const cookies = parseCookies(req.headers.cookie)
  return cookies.access_token || ''
}

const sendUnauthorized = (res) => respond(res, 401, { error: 'Access token mancante o non valido.' })

const makeCookieAttrs = (maxAge = 0) => {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (isProduction) attrs.push('Secure')
  return attrs.join('; ')
}

const clearAuthCookies = (res) => {
  const csrfAttrs = ['Path=/', 'SameSite=Lax', 'Max-Age=0']
  if (isProduction) csrfAttrs.push('Secure')
  res.setHeader('Set-Cookie', [
    `access_token=; ${makeCookieAttrs(0)}`,
    `refresh_token=; ${makeCookieAttrs(0)}`,
    `csrf_token=; ${csrfAttrs.join('; ')}`,
  ])
}

const setAuthCookies = (res, accessToken, refreshToken, csrfToken) => {
  const csrfAttrs = ['Path=/', 'SameSite=Lax', `Max-Age=${REFRESH_TOKEN_TTL_SECONDS}`]
  if (isProduction) csrfAttrs.push('Secure')
  const accessCookie = `access_token=${encodeURIComponent(accessToken)}; ${makeCookieAttrs(ACCESS_TOKEN_TTL_SECONDS)}`
  const refreshCookie = `refresh_token=${encodeURIComponent(refreshToken)}; ${makeCookieAttrs(REFRESH_TOKEN_TTL_SECONDS)}`
  const csrfCookie = `csrf_token=${encodeURIComponent(csrfToken)}; ${csrfAttrs.join('; ')}`
  res.setHeader('Set-Cookie', [accessCookie, refreshCookie, csrfCookie])
}

const loginRateLimits = new Map()
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000
const LOGIN_RATE_LIMIT_MAX = 10
const apiRateLimits = new Map()
const API_RATE_LIMIT_WINDOW_MS = 60_000
const API_RATE_LIMIT_MAX = 120

const checkRateLimitMap = ({ map, key, windowMs, max }) => {
  const now = Date.now()
  const entry = map.get(key) || { count: 0, resetAt: now + windowMs }
  if (now > entry.resetAt) {
    entry.count = 0
    entry.resetAt = now + windowMs
  }
  entry.count += 1
  map.set(key, entry)
  return entry.count <= max
}

const checkApiRateLimit = (req, res, userId = '') => {
  const key = userId || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimitMap({ map: apiRateLimits, key, windowMs: API_RATE_LIMIT_WINDOW_MS, max: API_RATE_LIMIT_MAX })) {
    respond(res, 429, { error: 'Troppe richieste, riprova più tardi.' })
    return false
  }
  return true
}

const checkLoginRateLimit = (req, res, username = '') => {
  const key = `${req.socket?.remoteAddress || 'unknown'}:${username || 'anonymous'}`
  if (!checkRateLimitMap({ map: loginRateLimits, key, windowMs: LOGIN_RATE_LIMIT_WINDOW_MS, max: LOGIN_RATE_LIMIT_MAX })) {
    respond(res, 429, { error: 'Troppi tentativi di login. Riprova tra qualche minuto.' })
    return false
  }
  return true
}

const ensureCsrf = (req, res) => {
  if (CSRF_SAFE_METHODS.has(req.method || 'GET')) return true
  const cookies = parseCookies(req.headers.cookie)
  const cookieToken = sanitizeString(cookies.csrf_token)
  const headerToken = sanitizeString(req.headers['x-csrf-token'])
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    respond(res, 403, { error: 'Token CSRF non valido.' })
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
    price_date TEXT,
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
  CREATE TABLE IF NOT EXISTS interventions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    urgency INTEGER NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    description TEXT,
    parent_intervention_id TEXT,
    additional_data TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL,
    FOREIGN KEY(client_id) REFERENCES customers(id)
  );
  CREATE TABLE IF NOT EXISTS spare_parts_orders (
    id TEXT PRIMARY KEY,
    intervention_id TEXT NOT NULL,
    parts TEXT,
    status TEXT NOT NULL,
    supplier TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL,
    FOREIGN KEY(intervention_id) REFERENCES interventions(id)
  );
  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    intervention_id TEXT NOT NULL,
    items TEXT,
    total_amount REAL,
    discount REAL,
    valid_until TEXT,
    status TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL,
    FOREIGN KEY(intervention_id) REFERENCES interventions(id)
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    approved INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`)

try { db.exec('ALTER TABLE inventory ADD COLUMN price_date TEXT') } catch { /* Column may already exist in migrated databases. */ }
try { db.exec('ALTER TABLE users ADD COLUMN email TEXT UNIQUE') } catch { /* Column may already exist in migrated databases. */ }
try { db.exec('ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT \'active\'') } catch { /* Column may already exist in migrated databases. */ }
try { db.exec('ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1') } catch { /* Column may already exist in migrated databases. */ }
try {
  db.exec("UPDATE users SET email = LOWER(username) WHERE email IS NULL OR email = ''")
  db.exec("UPDATE users SET status = COALESCE(NULLIF(status, ''), 'active')")
  db.exec('UPDATE users SET approved = COALESCE(approved, 1)')
} catch (error) {
  logEvent('error', 'db_migration_users_failed', { error: error?.message || String(error) })
}
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_logs (
    id TEXT PRIMARY KEY,
    protocol_version INTEGER NOT NULL,
    client_id TEXT,
    entity TEXT NOT NULL,
    record_id TEXT,
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS backup_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    file_name TEXT,
    drive_file_id TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL
  );
`)

const logSqlError = (operation, sql, params, error) => {
  logEvent('error', 'db_sql_failed', {
    operation,
    sql,
    params,
    error: error?.message || String(error),
  })
}

const getRow = (sql, params = []) => {
  try {
    return db.prepare(sql).get(...params)
  } catch (error) {
    logSqlError('get', sql, params, error)
    throw error
  }
}

const getAll = (sql, params = []) => {
  try {
    return db.prepare(sql).all(...params)
  } catch (error) {
    logSqlError('all', sql, params, error)
    throw error
  }
}

const runQuery = (sql, params = []) => {
  try {
    return db.prepare(sql).run(...params)
  } catch (error) {
    logSqlError('run', sql, params, error)
    throw error
  }
}

const formatBackupTimestampForName = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0')
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1)
  const day = pad(date.getUTCDate())
  const hours = pad(date.getUTCHours())
  const minutes = pad(date.getUTCMinutes())
  return `${year}-${month}-${day}-${hours}${minutes}`
}

const parseServiceAccountPrivateKey = () => {
  if (GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) return GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
  if (!GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64) return ''
  try {
    return Buffer.from(GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64, 'base64').toString('utf-8').replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}

const getGoogleAccessToken = async () => {
  const privateKey = parseServiceAccountPrivateKey()
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !privateKey) return ''
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = toBase64Url(JSON.stringify({
    iss: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  }))
  const unsignedToken = `${header}.${payload}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsignedToken)
  signer.end()
  const signature = signer.sign(privateKey, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const assertion = `${unsignedToken}.${signature}`

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const tokenPayload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(tokenPayload?.error_description || tokenPayload?.error || 'Token Google non disponibile')
  return tokenPayload?.access_token || ''
}

const googleDriveRequest = async ({ method = 'GET', endpoint, token, body, contentType = 'application/json' }) => {
  const response = await fetch(`https://www.googleapis.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': contentType } : {}),
    },
    body,
  })
  const text = await response.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  if (!response.ok) throw new Error(parsed?.error?.message || 'Google Drive request fallita')
  return parsed
}

const ensureDriveFolder = async (accessToken) => {
  if (!accessToken) return ''
  if (GOOGLE_DRIVE_FOLDER_ID) return GOOGLE_DRIVE_FOLDER_ID
  const escapedFolderName = GOOGLE_DRIVE_FOLDER_NAME.replace(/'/g, "''")
  const query = encodeURIComponent(`name='${escapedFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const existing = await googleDriveRequest({ endpoint: `/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=1`, token: accessToken })
  if (existing?.files?.length) return existing.files[0].id
  const created = await googleDriveRequest({
    method: 'POST',
    endpoint: '/drive/v3/files?fields=id',
    token: accessToken,
    body: JSON.stringify({ name: GOOGLE_DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })
  return created?.id || ''
}

const uploadBackupToDrive = async ({ accessToken, fileName, jsonBuffer, folderId }) => {
  const boundary = `backup-boundary-${Date.now()}`
  const metadata = JSON.stringify({ name: fileName, ...(folderId ? { parents: [folderId] } : {}) })
  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}
Content-Type: application/json; charset=UTF-8

${metadata}
`),
    Buffer.from(`--${boundary}
Content-Type: application/json

`),
    jsonBuffer,
    Buffer.from(`
--${boundary}--`),
  ])

  return googleDriveRequest({
    method: 'POST',
    endpoint: '/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    token: accessToken,
    body: multipartBody,
    contentType: `multipart/related; boundary=${boundary}`,
  })
}

const readBackupDataset = () => ({
  users: getAll('SELECT id, username, email, role, status, approved, created_at, updated_at FROM users ORDER BY created_at ASC'),
  tickets: getAll('SELECT * FROM tickets ORDER BY created_at ASC'),
  interventions: getAll('SELECT * FROM interventions ORDER BY created_at ASC'),
  customers: getAll('SELECT * FROM customers ORDER BY created_at ASC'),
  inventory: getAll('SELECT * FROM inventory ORDER BY created_at ASC'),
})

const buildBackupPayload = () => ({
  exportedAt: nowIso(),
  source: 'server',
  ...readBackupDataset(),
})

const toCsvValue = (value) => {
  if (value === null || value === undefined) return ''
  const safe = String(value).replace(/"/g, '""')
  return `"${safe}"`
}

const toCsvBuffer = (headers = [], rows = []) => {
  const csvRows = [headers.map(toCsvValue).join(',')]
  rows.forEach((row) => {
    csvRows.push(headers.map((header) => toCsvValue(row?.[header])).join(','))
  })
  return Buffer.from(`${csvRows.join('\n')}\n`, 'utf-8')
}

const storeBackupRun = ({ status, fileName = '', driveFileId = '', errorMessage = '' }) => {
  runQuery(
    'INSERT INTO backup_runs (id, status, file_name, drive_file_id, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [ensureId(), status, fileName || null, driveFileId || null, errorMessage || null, nowIso()],
  )
}

const getLastBackupRun = () => getRow('SELECT id, status, file_name, drive_file_id, error_message, created_at FROM backup_runs ORDER BY created_at DESC LIMIT 1')

const performBackup = async ({ triggeredBy = 'manual' } = {}) => {
  const payload = buildBackupPayload()
  const backupFileName = `backup-${formatBackupTimestampForName(new Date())}.json`
  const backupJson = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8')
  try {
    const accessToken = await getGoogleAccessToken()
    if (!accessToken) {
      const message = 'Google Drive non configurato: backup salvato solo localmente/log.'
      console.warn(`[backup] ${message}`)
      storeBackupRun({ status: 'degraded', fileName: backupFileName, errorMessage: message })
      return { ok: true, mode: 'degraded', fileName: backupFileName, exportedAt: payload.exportedAt, message }
    }
    const folderId = await ensureDriveFolder(accessToken)
    const created = await uploadBackupToDrive({ accessToken, fileName: backupFileName, jsonBuffer: backupJson, folderId })
    const driveFileId = created?.id || ''
    storeBackupRun({ status: 'success', fileName: backupFileName, driveFileId })
    console.log(`[backup] ${triggeredBy} completato: ${backupFileName} (${driveFileId || 'no-id'})`)
    return { ok: true, mode: 'drive', fileName: backupFileName, exportedAt: payload.exportedAt, driveFileId }
  } catch (error) {
    const message = error?.message || 'Errore backup sconosciuto'
    storeBackupRun({ status: 'failed', fileName: backupFileName, errorMessage: message })
    logEvent('error', 'backup_failed', { error: message })
    return { ok: false, mode: 'failed', fileName: backupFileName, exportedAt: payload.exportedAt, message }
  }
}

const ensureAdminUser = () => {
  const adminUsername = sanitizeString(ADMIN_USER || 'admin')
  const adminPassword = sanitizeString(ADMIN_PASS)
  const existingAdmin = getRow('SELECT id FROM users WHERE username = ?', [adminUsername])
  if (!existingAdmin && adminPassword) {
    runQuery(
      'INSERT INTO users (id, username, email, password_hash, role, status, approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ensureId(), adminUsername, normalizeEmail(adminUsername), hashPassword(adminPassword), 'admin', 'active', 1, nowIso(), nowIso()],
    )
    console.log(`[auth] Admin seed creato per utente ${adminUsername}.`)
  }
}

ensureAdminUser()

const ticketsCount = getRow('SELECT COUNT(*) AS total FROM tickets')?.total || 0
const interventionsCount = getRow('SELECT COUNT(*) AS total FROM interventions')?.total || 0
if (ticketsCount > 0 && interventionsCount === 0) {
  const legacyTickets = getAll('SELECT * FROM tickets')
  legacyTickets.forEach((ticket) => {
    runQuery(
      'INSERT INTO interventions (id, client_id, type, status, urgency, opened_at, closed_at, description, parent_intervention_id, additional_data, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        ensureId(ticket.id),
        ticket.customer_id || '',
        'chiamata',
        INTERVENTION_STATUSES.has(ticket.status) ? ticket.status : 'pendente',
        2,
        ticket.date ? `${ticket.date}T${ticket.time || '09:00'}:00.000Z` : nowIso(),
        ticket.status === 'chiuso' ? nowIso() : null,
        ticket.description || ticket.subject || '',
        null,
        JSON.stringify({ legacyTicketId: ticket.id, subject: ticket.subject }),
        ticket.created_at || nowIso(),
        ticket.updated_at || nowIso(),
        ticket.version || 1,
      ],
    )
  })
}

const parseVersion = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.trunc(parsed))
}

const ensureUpdatedAt = (value) => normalizeIso(value) || nowIso()

const compareSyncFreshness = (existing, incoming) => {
  const existingUpdatedAt = normalizeIso(existing?.updated_at)
  const incomingUpdatedAt = normalizeIso(incoming?.updatedAt)

  if (incomingUpdatedAt && existingUpdatedAt) {
    if (incomingUpdatedAt > existingUpdatedAt) return 1
    if (incomingUpdatedAt < existingUpdatedAt) return -1
  }

  const existingVersion = parseVersion(existing?.version) ?? 0
  const incomingVersion = parseVersion(incoming?.version) ?? 0
  if (incomingVersion > existingVersion) return 1
  if (incomingVersion < existingVersion) return -1

  return 0
}

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


const SYNC_PROTOCOL_VERSION = 1
const SYNC_MAX_LOG_ROWS = 2000

const logSyncOperation = ({ protocolVersion, clientId, entity, recordId, action, result, detail }) => {
  runQuery(
    'INSERT INTO sync_logs (id, protocol_version, client_id, entity, record_id, action, result, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      ensureId(),
      sanitizeNumber(protocolVersion, SYNC_PROTOCOL_VERSION),
      sanitizeString(clientId) || null,
      sanitizeString(entity, 'unknown'),
      sanitizeString(recordId) || null,
      sanitizeString(action, 'noop'),
      sanitizeString(result, 'ok'),
      detail ? JSON.stringify(detail) : null,
      nowIso(),
    ],
  )
}

const trimSyncLog = () => {
  const total = getRow('SELECT COUNT(*) AS total FROM sync_logs')?.total || 0
  if (total <= SYNC_MAX_LOG_ROWS) return
  const toDelete = total - SYNC_MAX_LOG_ROWS
  runQuery(
    `DELETE FROM sync_logs
      WHERE id IN (
        SELECT id FROM sync_logs
        ORDER BY created_at ASC
        LIMIT ?
      )`,
    [toDelete],
  )
}

const parseSyncBody = (payload) => {
  const protocolVersion = sanitizeNumber(payload?.protocolVersion, null)
  if (protocolVersion === null) {
    return { error: 'protocolVersion obbligatorio.' }
  }
  if (protocolVersion !== SYNC_PROTOCOL_VERSION) {
    return { error: `Versione protocollo non supportata (${protocolVersion}).`, status: 426 }
  }
  return {
    value: {
      protocolVersion,
      clientId: sanitizeString(payload?.clientId),
      lastSyncAt: normalizeIso(payload?.lastSyncAt),
      state: payload?.state && typeof payload.state === 'object' ? payload.state : {},
      changes: payload?.changes && typeof payload.changes === 'object' ? payload.changes : {},
    },
  }
}

const hashChecksum = (value) => crypto.createHash('sha256').update(value).digest('hex')

const parseEntityState = (rawState = {}) => {
  const version = sanitizeNumber(rawState?.version, 0)
  const checksum = sanitizeString(rawState?.checksum)
  return {
    version: Number.isFinite(version) ? Math.max(0, Math.trunc(version)) : 0,
    checksum,
  }
}

const syncEntities = {
  customers: {
    table: 'customers',
    key: 'id',
    validate: validateCustomerPayload,
    map: mapCustomerRow,
    insert: (value) => runQuery(
      'INSERT INTO customers (id, name, email, phone, address, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.name, value.email, value.phone, value.address, nowIso(), value.updatedAt, Math.max(1, parseVersion(value.version) || 1)],
    ),
    update: (existing, value) => runQuery(
      'UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.name, value.email, value.phone, value.address, value.updatedAt, Math.max((parseVersion(existing.version) || 0) + 1, parseVersion(value.version) || 1), value.id],
    ),
  },
  tickets: {
    table: 'tickets',
    key: 'id',
    validate: validateTicketPayload,
    map: mapTicketRow,
    insert: (value) => runQuery(
      'INSERT INTO tickets (id, subject, description, customer_id, status, date, time, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.subject, value.description, value.customerId, value.status, value.date, value.time, nowIso(), value.updatedAt, Math.max(1, parseVersion(value.version) || 1)],
    ),
    update: (existing, value) => runQuery(
      'UPDATE tickets SET subject = ?, description = ?, customer_id = ?, status = ?, date = ?, time = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.subject, value.description, value.customerId, value.status, value.date, value.time, value.updatedAt, Math.max((parseVersion(existing.version) || 0) + 1, parseVersion(value.version) || 1), value.id],
    ),
  },
  inventory: {
    table: 'inventory',
    key: 'id',
    validate: validateInventoryPayload,
    map: mapInventoryRow,
    insert: (value) => runQuery(
      'INSERT INTO inventory (id, name, location, qty, price, min_qty, price_date, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.name, value.location, value.qty, value.price, value.minQty, value.priceDate, nowIso(), value.updatedAt, Math.max(1, parseVersion(value.version) || 1)],
    ),
    update: (existing, value) => runQuery(
      'UPDATE inventory SET name = ?, location = ?, qty = ?, price = ?, min_qty = ?, price_date = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.name, value.location, value.qty, value.price, value.minQty, value.priceDate, value.updatedAt, Math.max((parseVersion(existing.version) || 0) + 1, parseVersion(value.version) || 1), value.id],
    ),
  },
  interventions: {
    table: 'interventions',
    key: 'id',
    validate: validateInterventionPayload,
    map: mapInterventionRow,
    insert: (value) => runQuery(
      `INSERT INTO interventions (id, client_id, type, status, urgency, opened_at, closed_at, description, parent_intervention_id, additional_data, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.clientId, value.type, value.status, value.urgency, value.openedAt, value.closedAt, value.description, value.parentInterventionId, value.additionalData, nowIso(), value.updatedAt, Math.max(1, parseVersion(value.version) || 1)],
    ),
    update: (existing, value) => runQuery(
      `UPDATE interventions
       SET client_id = ?, type = ?, status = ?, urgency = ?, opened_at = ?, closed_at = ?, description = ?, parent_intervention_id = ?, additional_data = ?, updated_at = ?, version = ?
       WHERE id = ?`,
      [
        value.clientId,
        value.type,
        value.status,
        value.urgency,
        value.openedAt,
        value.closedAt,
        value.description,
        value.parentInterventionId,
        value.additionalData,
        value.updatedAt,
        Math.max((parseVersion(existing.version) || 0) + 1, parseVersion(value.version) || 1),
        value.id,
      ],
    ),
  },
}

const areRecordsEquivalent = (entityName, existing, value) => {
  if (entityName === 'customers') {
    return existing.name === value.name
      && existing.email === value.email
      && existing.phone === value.phone
      && existing.address === value.address
      && normalizeIso(existing.updated_at) === normalizeIso(value.updatedAt)
  }
  if (entityName === 'tickets') {
    return existing.subject === value.subject
      && existing.description === value.description
      && existing.customer_id === value.customerId
      && existing.status === value.status
      && existing.date === value.date
      && existing.time === value.time
      && normalizeIso(existing.updated_at) === normalizeIso(value.updatedAt)
  }
  if (entityName === 'inventory') {
    return existing.name === value.name
      && existing.location === value.location
      && Number(existing.qty) === Number(value.qty)
      && Number(existing.price) === Number(value.price)
      && Number(existing.min_qty) === Number(value.minQty)
      && (existing.price_date || '') === (value.priceDate || '')
      && normalizeIso(existing.updated_at) === normalizeIso(value.updatedAt)
  }
  if (entityName === 'interventions') {
    return existing.client_id === value.clientId
      && existing.type === value.type
      && existing.status === value.status
      && Number(existing.urgency) === Number(value.urgency)
      && normalizeIso(existing.opened_at) === normalizeIso(value.openedAt)
      && normalizeIso(existing.closed_at) === normalizeIso(value.closedAt)
      && (existing.description || '') === (value.description || '')
      && (existing.parent_intervention_id || null) === (value.parentInterventionId || null)
      && (existing.additional_data || '{}') === (value.additionalData || '{}')
      && normalizeIso(existing.updated_at) === normalizeIso(value.updatedAt)
  }
  return false
}

const applySyncChanges = (syncInput) => {
  const applied = {}
  const conflicts = {}
  const rejected = {}

  Object.entries(syncEntities).forEach(([entityName, config]) => {
    const incomingItems = Array.isArray(syncInput.changes[entityName]) ? syncInput.changes[entityName] : []
    applied[entityName] = []
    conflicts[entityName] = []
    rejected[entityName] = []

    incomingItems.forEach((item) => {
      const { error, value } = config.validate(item)
      if (error) {
        rejected[entityName].push({ reason: error, item })
        logSyncOperation({
          protocolVersion: syncInput.protocolVersion,
          clientId: syncInput.clientId,
          entity: entityName,
          recordId: item?.id,
          action: 'upsert',
          result: 'invalid',
          detail: { reason: error },
        })
        return
      }

      const existing = getRow(`SELECT * FROM ${config.table} WHERE ${config.key} = ?`, [value.id])
      if (!existing) {
        config.insert(value)
        const inserted = config.map(getRow(`SELECT * FROM ${config.table} WHERE ${config.key} = ?`, [value.id]))
        applied[entityName].push(inserted)
        logSyncOperation({
          protocolVersion: syncInput.protocolVersion,
          clientId: syncInput.clientId,
          entity: entityName,
          recordId: value.id,
          action: 'insert',
          result: 'applied',
        })
        return
      }

      if (areRecordsEquivalent(entityName, existing, value)) {
        const current = config.map(existing)
        applied[entityName].push(current)
        logSyncOperation({
          protocolVersion: syncInput.protocolVersion,
          clientId: syncInput.clientId,
          entity: entityName,
          recordId: value.id,
          action: 'update',
          result: 'noop',
        })
        return
      }

      const freshness = compareSyncFreshness(existing, value)
      if (freshness <= 0) {
        const current = config.map(existing)
        conflicts[entityName].push({ id: value.id, reason: 'timestamp', current })
        logSyncOperation({
          protocolVersion: syncInput.protocolVersion,
          clientId: syncInput.clientId,
          entity: entityName,
          recordId: value.id,
          action: 'update',
          result: 'resolved_conflict',
          detail: { reason: 'last_write_wins', winner: 'server' },
        })
        return
      }

      config.update(existing, value)
      const updated = config.map(getRow(`SELECT * FROM ${config.table} WHERE ${config.key} = ?`, [value.id]))
      applied[entityName].push(updated)
      logSyncOperation({
        protocolVersion: syncInput.protocolVersion,
        clientId: syncInput.clientId,
        entity: entityName,
        recordId: value.id,
        action: 'update',
        result: 'applied',
      })
    })
  })

  trimSyncLog()
  return { applied, conflicts, rejected }
}

const collectSyncDelta = (lastSyncAt, state = {}) => {
  const pullRows = (table, mapper) => {
    if (!lastSyncAt) return getAll(`SELECT * FROM ${table}`).map(mapper)
    return getAll(`SELECT * FROM ${table} WHERE updated_at > ?`, [lastSyncAt]).map(mapper)
  }

  const shouldSendFullEntity = (entityName) => {
    const clientState = parseEntityState(state[entityName])
    if (!clientState.version && !clientState.checksum) return false
    const serverState = getServerEntityState(entityName)
    return clientState.version !== serverState.version || clientState.checksum !== serverState.checksum
  }

  const pullEntity = (entityName, table, mapper) => {
    if (shouldSendFullEntity(entityName)) {
      return getAll(`SELECT * FROM ${table}`).map(mapper)
    }
    return pullRows(table, mapper)
  }

  return {
    customers: pullEntity('customers', 'customers', mapCustomerRow),
    tickets: pullEntity('tickets', 'tickets', mapTicketRow),
    inventory: pullEntity('inventory', 'inventory', mapInventoryRow),
    interventions: pullEntity('interventions', 'interventions', mapInterventionRow),
  }
}

const entitySyncState = {
  customers: { table: 'customers', map: mapCustomerRow },
  tickets: { table: 'tickets', map: mapTicketRow },
  inventory: { table: 'inventory', map: mapInventoryRow },
  interventions: { table: 'interventions', map: mapInterventionRow },
}

const getServerEntityState = (entityName) => {
  const config = entitySyncState[entityName]
  if (!config) return { version: 0, checksum: hashChecksum('[]') }
  const rows = getAll(`SELECT * FROM ${config.table} ORDER BY id ASC`).map(config.map)
  const version = rows.reduce((acc, row) => acc + sanitizeNumber(row?.version, 0), 0)
  const normalized = rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt, version: row.version }))
  const checksum = hashChecksum(JSON.stringify(normalized))
  return { version, checksum }
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

const authenticateRequest = (req) => {
  const token = getTokenFromRequest(req)
  const payload = verifyJwt(token, JWT_ACCESS_SECRET)
  if (!payload || payload.type !== 'access') return null
  const user = getRow('SELECT id, username, email, role, status, approved FROM users WHERE id = ?', [payload.sub])
  if (!user || !USER_ROLES.has(user.role)) return null
  if (!user.approved) return null
  if (!['active', 'pending'].includes(sanitizeString(user.status, 'active'))) return null
  return user
}

const ensureAuth = (req, res) => {
  const user = authenticateRequest(req)
  if (!user) {
    sendUnauthorized(res)
    return null
  }
  return user
}

const ensureRole = (res, user, allowedRoles = []) => {
  if (!allowedRoles.includes(user.role)) {
    respond(res, 403, { error: 'Permessi insufficienti per questa operazione.' })
    return false
  }
  return true
}

const ensureRouteAuthorization = (req, res, user, pathname) => {
  if (user.role === 'admin') return true

  if (user.role === 'tech' || user.role === 'operator') {
    if (pathname.startsWith('/api/import')) {
      respond(res, 403, { error: 'Permessi insufficienti per questa operazione.' })
      return false
    }
    return true
  }

  if (user.role === 'read') {
    if (!CSRF_SAFE_METHODS.has(req.method || 'GET')) {
      respond(res, 403, { error: 'Permessi insufficienti per questa operazione.' })
      return false
    }
    return true
  }

  respond(res, 403, { error: 'Permessi insufficienti per questa operazione.' })
  return false
}

const handleApiRequest = async (req, res, url) => {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    const user = ensureAuth(req, res)
    if (!user) return
    return respond(res, 200, { status: 'ok', time: nowIso() })
  }

  if (!checkApiRateLimit(req, res)) return

  if (url.pathname === '/api/deepseek' && req.method === 'POST') {
    const user = ensureAuth(req, res)
    if (!user) return
    if (!ensureCsrf(req, res)) return
    return handleDeepSeekProxy(req, res)
  }

  if (url.pathname === '/api/rag' && req.method === 'POST') {
    const user = ensureAuth(req, res)
    if (!user) return
    if (!ensureCsrf(req, res)) return
    return handleRagProxy(req, res)
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const username = sanitizeString(payload?.username)
      const email = normalizeEmail(payload?.email)
      const identifier = username || email
      const password = sanitizeString(payload?.password)
      if (!identifier || !password) return respond(res, 400, { error: 'Email e password sono obbligatorie.', code: 'missing_credentials' })
      if (!checkLoginRateLimit(req, res, identifier)) return
      const user = getRow("SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(COALESCE(email, '')) = LOWER(?)", [identifier, identifier])
      if (!user) {
        return respond(res, 404, { error: 'Utente non trovato.', code: 'user_not_found' })
      }
      if (!verifyPassword(password, user.password_hash)) {
        logEvent('warn', 'login_failed', { user: identifier || 'n/a', ip: req.socket?.remoteAddress || 'unknown' })
        return respond(res, 401, { error: 'Credenziali errate.', code: 'invalid_credentials' })
      }
      if (!user.approved) return respond(res, 403, { error: 'Utente non approvato.', code: 'user_not_approved' })
      if (!['active', 'pending'].includes(sanitizeString(user.status, 'active'))) {
        return respond(res, 403, { error: 'Utente non attivo.', code: 'user_inactive' })
      }
      const { accessToken, refreshToken, refreshId, csrfToken } = createAuthTokens(user)
      runQuery(
        'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [refreshId, user.id, hashValue(refreshToken), new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(), null, nowIso()],
      )
      setAuthCookies(res, accessToken, refreshToken, csrfToken)
      return respond(res, 200, { accessToken, user: { id: user.id, username: user.username, email: user.email || user.username, role: user.role, status: user.status, approved: Boolean(user.approved) } })
    } catch (error) {
      return handleErrorResponse(res, error, { path: url.pathname, method: req.method })
    }
  }

  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const payload = await readJsonBody(req)
      const email = normalizeEmail(payload?.email)
      const password = sanitizeString(payload?.password)
      if (!email || !password) {
        return respond(res, 400, { error: 'Email e password sono obbligatorie.', code: 'missing_credentials' })
      }
      if (!isValidEmail(email)) {
        return respond(res, 400, { error: 'Email non valida.', code: 'invalid_email' })
      }
      if (password.length < 8) {
        return respond(res, 400, { error: 'La password deve avere almeno 8 caratteri.', code: 'weak_password' })
      }
      if (getRow("SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(COALESCE(email, '')) = LOWER(?)", [email, email])) {
        return respond(res, 409, { error: 'Utente già registrato.', code: 'user_exists' })
      }
      const user = {
        id: ensureId(),
        username: email,
        email,
        role: 'operator',
        status: 'pending',
        approved: 1,
      }
      runQuery(
        'INSERT INTO users (id, username, email, password_hash, role, status, approved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user.id, user.username, user.email, hashPassword(password), user.role, user.status, user.approved, nowIso(), nowIso()],
      )
      const { accessToken, refreshToken, refreshId, csrfToken } = createAuthTokens(user)
      runQuery(
        'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [refreshId, user.id, hashValue(refreshToken), new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(), null, nowIso()],
      )
      setAuthCookies(res, accessToken, refreshToken, csrfToken)
      return respond(res, 201, { accessToken, user: { id: user.id, username: user.username, email: user.email, role: user.role, status: user.status, approved: true } })
    } catch (error) {
      return handleErrorResponse(res, error, { path: url.pathname, method: req.method })
    }
  }

  if (url.pathname === '/api/auth/refresh' && req.method === 'POST') {
    if (!ensureCsrf(req, res)) return
    const cookies = parseCookies(req.headers.cookie)
    const refreshToken = cookies.refresh_token || ''
    const payload = verifyJwt(refreshToken, JWT_REFRESH_SECRET)
    if (!payload || payload.type !== 'refresh' || !payload.jti) {
      clearAuthCookies(res)
      return respond(res, 401, { error: 'Sessione scaduta.', code: 'session_expired' })
    }
    const record = getRow('SELECT * FROM refresh_tokens WHERE id = ?', [payload.jti])
    if (!record || record.revoked_at || record.token_hash !== hashValue(refreshToken) || new Date(record.expires_at).getTime() <= Date.now()) {
      clearAuthCookies(res)
      return respond(res, 401, { error: 'Sessione scaduta.', code: 'session_expired' })
    }
    const user = getRow('SELECT id, username, email, role, status, approved FROM users WHERE id = ?', [record.user_id])
    if (!user) return respond(res, 404, { error: 'Utente non trovato.', code: 'user_not_found' })
    if (!user.approved || !['active', 'pending'].includes(sanitizeString(user.status, 'active'))) {
      clearAuthCookies(res)
      return respond(res, 401, { error: 'Sessione non valida.', code: 'session_invalid' })
    }
    runQuery('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', [nowIso(), record.id])
    const next = createAuthTokens(user)
    runQuery(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [next.refreshId, user.id, hashValue(next.refreshToken), new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(), null, nowIso()],
    )
    setAuthCookies(res, next.accessToken, next.refreshToken, next.csrfToken)
    return respond(res, 200, { accessToken: next.accessToken, user: { ...user, approved: Boolean(user.approved) } })
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    if (!ensureCsrf(req, res)) return
    const cookies = parseCookies(req.headers.cookie)
    const refreshToken = cookies.refresh_token || ''
    const payload = verifyJwt(refreshToken, JWT_REFRESH_SECRET)
    if (payload?.jti) {
      runQuery('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?', [nowIso(), payload.jti])
    }
    clearAuthCookies(res)
    return respond(res, 200, { ok: true })
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    try {
      const user = authenticateRequest(req)
      if (!user) return respond(res, 401, { error: 'Sessione scaduta.', code: 'session_expired' })
      return respond(res, 200, { user })
    } catch (error) {
      console.warn('[auth] /api/auth/me non disponibile temporaneamente', error)
      return respond(res, 503, { error: 'Servizio autenticazione temporaneamente non disponibile.', code: 'auth_temporarily_unavailable' })
    }
  }

  if (!url.pathname.startsWith('/api/')) {
    return respond(res, 404, { error: 'Endpoint non valido.' })
  }

  const user = ensureAuth(req, res)
  if (!user) return
  if (!ensureRouteAuthorization(req, res, user, url.pathname)) return
  if (!ensureCsrf(req, res)) return
  if (!checkApiRateLimit(req, res, user.id)) return

  if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
    return respond(res, 200, {
      customers: getAll('SELECT * FROM customers').map(mapCustomerRow),
      tickets: getAll('SELECT * FROM tickets').map(mapTicketRow),
      interventions: getAll('SELECT * FROM interventions').map(mapInterventionRow),
      sparePartsOrders: getAll('SELECT * FROM spare_parts_orders').map(mapSparePartOrderRow),
      quotes: getAll('SELECT * FROM quotes').map(mapQuoteRow),
      inventory: getAll('SELECT * FROM inventory').map(mapInventoryRow),
      settings: getAll('SELECT * FROM settings').map(mapSettingRow),
    })
  }


  if (req.method === 'POST' && url.pathname === '/api/sync') {
    let transactionOpen = false
    try {
      const payload = await readJsonBody(req)
      const parsed = parseSyncBody(payload)
      if (parsed.error) {
        return respond(res, parsed.status || 400, { error: parsed.error, supportedProtocolVersion: SYNC_PROTOCOL_VERSION })
      }

      db.exec('BEGIN')
      transactionOpen = true
      const syncResult = applySyncChanges(parsed.value)
      db.exec('COMMIT')
      transactionOpen = false

      const pulled = collectSyncDelta(parsed.value.lastSyncAt, parsed.value.state)
      return respond(res, 200, {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        serverTime: nowIso(),
        ...syncResult,
        pulled,
      })
    } catch (error) {
      if (transactionOpen) {
        db.exec('ROLLBACK')
      }
      return respond(res, 400, { error: error.message || 'Errore durante la sincronizzazione.' })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    if (!ensureRole(res, user, ['admin'])) return
    try {
      const payload = await readJsonBody(req)
      const customers = Array.isArray(payload?.customers) ? payload.customers : []
      const tickets = Array.isArray(payload?.tickets) ? payload.tickets : []
      const interventions = Array.isArray(payload?.interventions) ? payload.interventions : []
      const sparePartsOrders = Array.isArray(payload?.sparePartsOrders) ? payload.sparePartsOrders : []
      const quotes = Array.isArray(payload?.quotes) ? payload.quotes : []
      const inventory = Array.isArray(payload?.inventory) ? payload.inventory : []
      const settings = Array.isArray(payload?.settings) ? payload.settings : []
      db.exec('BEGIN')
      runQuery('DELETE FROM customers')
      runQuery('DELETE FROM tickets')
      runQuery('DELETE FROM interventions')
      runQuery('DELETE FROM spare_parts_orders')
      runQuery('DELETE FROM quotes')
      runQuery('DELETE FROM inventory')
      runQuery('DELETE FROM settings')
      customers.forEach((customer) => {
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
      interventions.forEach((intervention) => {
        const { error, value } = validateInterventionPayload(intervention)
        if (error) throw new Error(error)
        runQuery(
          'INSERT INTO interventions (id, client_id, type, status, urgency, opened_at, closed_at, description, parent_intervention_id, additional_data, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.clientId, value.type, value.status, value.urgency, value.openedAt, value.closedAt, value.description, value.parentInterventionId, value.additionalData, nowIso(), value.updatedAt, value.version || 1],
        )
      })
      sparePartsOrders.forEach((order) => {
        const { error, value } = validateSparePartOrderPayload(order)
        if (error) throw new Error(error)
        runQuery(
          'INSERT INTO spare_parts_orders (id, intervention_id, parts, status, supplier, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.interventionId, value.parts, value.status, value.supplier, value.notes, nowIso(), value.updatedAt, value.version || 1],
        )
      })
      quotes.forEach((quote) => {
        const { error, value } = validateQuotePayload(quote)
        if (error) throw new Error(error)
        runQuery(
          'INSERT INTO quotes (id, intervention_id, items, total_amount, discount, valid_until, status, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.interventionId, value.items, value.totalAmount, value.discount, value.validUntil, value.status, value.notes, nowIso(), value.updatedAt, value.version || 1],
        )
      })
      inventory.forEach((item) => {
        const { error, value } = validateInventoryPayload(item)
        if (error) throw new Error(error)
        runQuery(
          'INSERT INTO inventory (id, name, location, qty, price, min_qty, price_date, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.name, value.location, value.qty, value.price, value.minQty, value.priceDate, nowIso(), value.updatedAt, value.version || 1],
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
          'UPDATE inventory SET name = ?, location = ?, qty = ?, price = ?, min_qty = ?, price_date = ?, updated_at = ?, version = ? WHERE id = ?',
          [
            value.name,
            value.location,
            newQty,
            value.price,
            value.minQty,
            value.priceDate,
            nowIso(),
            existing.version + 1,
            value.id,
          ],
        )
        updatedItems.push(mapInventoryRow(getRow('SELECT * FROM inventory WHERE id = ?', [value.id])))
      } else {
        runQuery(
          'INSERT INTO inventory (id, name, location, qty, price, min_qty, price_date, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [value.id, value.name, value.location, value.qty, value.price, value.minQty, value.priceDate, nowIso(), value.updatedAt, 1],
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


  if (isDatabaseConfigured && req.method === 'GET' && (url.pathname === '/api/customers' || url.pathname === '/api/clienti')) {
    const { q, sortColumn, order, skip, take } = parseListQuery(url, {
      defaultSort: 'createdAt',
      allowedSort: ['createdAt', 'updatedAt', 'name', 'email', 'phone'],
    })
    const rows = await prisma.customer.findMany({
      where: q ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { address: { contains: q, mode: 'insensitive' } },
        ],
      } : undefined,
      orderBy: { [sortColumn]: order.toLowerCase() },
      skip,
      take,
    })
    return respond(res, 200, rows)
  }

  if (isDatabaseConfigured && req.method === 'POST' && url.pathname === '/api/customers') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const payload = await readJsonBody(req)
    const { error, value } = validateCustomerPayload(payload)
    if (error) return respond(res, 400, { error })
    const created = await prisma.customer.create({
      data: { id: value.id, name: value.name, email: value.email || null, phone: value.phone || null, address: value.address || null },
    })
    return respond(res, 201, created)
  }

  if (isDatabaseConfigured && req.method === 'PUT' && url.pathname.startsWith('/api/customers/')) {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const id = match(/^\/api\/customers\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Cliente non trovato.' })
    const payload = await readJsonBody(req)
    const { error, value } = validateCustomerPayload({ ...payload, id })
    if (error) return respond(res, 400, { error })
    const updated = await prisma.customer.update({ where: { id }, data: { name: value.name, email: value.email || null, phone: value.phone || null, address: value.address || null } })
    return respond(res, 200, updated)
  }

  if (isDatabaseConfigured && req.method === 'GET' && (url.pathname === '/api/interventions' || url.pathname === '/api/chiamate' || url.pathname === '/api/riparazioni')) {
    const customerId = sanitizeString(url.searchParams.get('customerId') || url.searchParams.get('clientId'))
    const type = sanitizeString(url.searchParams.get('type'))
    const typeFromPath = url.pathname === '/api/chiamate' ? 'chiamata' : (url.pathname === '/api/riparazioni' ? 'riparazione' : '')
    const status = sanitizeString(url.searchParams.get('status'))
    const typeFilter = INTERVENTION_TYPES.has(typeFromPath || type) ? (typeFromPath || type) : ''
    const statusFilter = INTERVENTION_STATUSES.has(status) ? status : ''
    const { q, sortColumn, order, skip, take } = parseListQuery(url, {
      defaultSort: 'openedAt',
      allowedSort: ['openedAt', 'updatedAt', 'priority', 'status', 'type', 'code'],
    })
    const rows = await prisma.intervention.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(q ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        } : {}),
      },
      orderBy: { [sortColumn]: order.toLowerCase() },
      skip,
      take,
    })
    return respond(res, 200, rows.map(mapPrismaIntervention))
  }

  if (isDatabaseConfigured && req.method === 'POST' && url.pathname === '/api/interventions') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const payload = await readJsonBody(req)
    const { error, value } = validateInterventionPayload(payload)
    if (error) return respond(res, 400, { error })
    const created = await prisma.intervention.create({
      data: {
        id: value.id,
        code: interventionCode(),
        customerId: value.clientId,
        type: value.type,
        status: value.status,
        priority: value.urgency,
        description: value.description,
        openedAt: ensureDate(value.openedAt),
        closedAt: value.closedAt ? ensureDate(value.closedAt) : null,
        additionalData: JSON.parse(value.additionalData || '{}'),
      },
    })
    return respond(res, 201, mapPrismaIntervention(created))
  }

  if (isDatabaseConfigured && (req.method === 'PUT' || req.method === 'PATCH') && url.pathname.startsWith('/api/interventions/')) {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const id = match(/^\/api\/interventions\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Intervento non trovato.' })
    const payload = await readJsonBody(req)
    const data = {}
    if (payload.status) {
      if (!INTERVENTION_STATUSES.has(payload.status)) return respond(res, 400, { error: 'Stato intervento non valido.' })
      data.status = payload.status
    }
    if (payload.priority !== undefined || payload.urgency !== undefined) data.priority = sanitizeNumber(payload.priority ?? payload.urgency, 2)
    if (payload.assignedTo !== undefined) data.assignedTo = sanitizeString(payload.assignedTo) || null
    if (payload.description !== undefined || payload.notes !== undefined) data.description = sanitizeString(payload.description || payload.notes)
    if (Object.keys(data).length === 0) {
      const { error, value } = validateInterventionPayload({ ...payload, id })
      if (error) return respond(res, 400, { error })
      data.customerId = value.clientId
      data.type = value.type
      data.status = value.status
      data.priority = value.urgency
      data.openedAt = ensureDate(value.openedAt)
      data.closedAt = value.closedAt ? ensureDate(value.closedAt) : null
      data.description = value.description
      data.additionalData = JSON.parse(value.additionalData || '{}')
    }
    const updated = await prisma.intervention.update({ where: { id }, data: { ...data, version: { increment: 1 } } })
    if (payload.notes) {
      await prisma.note.create({ data: { interventionId: id, content: sanitizeString(payload.notes) } })
    }
    return respond(res, 200, mapPrismaIntervention(updated))
  }

  if (isDatabaseConfigured && req.method === 'GET' && url.pathname === '/api/calendar') {
    const from = normalizeIso(url.searchParams.get('from'))
    const to = normalizeIso(url.searchParams.get('to'))
    const rows = await prisma.calendarItem.findMany({
      where: {
        ...(from || to ? {
          AND: [
            ...(from ? [{ endAt: { gte: new Date(from) } }] : []),
            ...(to ? [{ startAt: { lte: new Date(to) } }] : []),
          ],
        } : {}),
      },
      orderBy: { startAt: 'asc' },
    })
    return respond(res, 200, rows)
  }

  if (isDatabaseConfigured && req.method === 'POST' && url.pathname === '/api/calendar') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const payload = await readJsonBody(req)
    const title = sanitizeString(payload?.title)
    if (!title) return respond(res, 400, { error: 'title obbligatorio.' })
    const created = await prisma.calendarItem.create({
      data: {
        title,
        description: sanitizeString(payload.description) || null,
        startAt: ensureDate(payload.startAt || payload.from),
        endAt: ensureDate(payload.endAt || payload.to),
        status: sanitizeString(payload.status, 'planned'),
        customerId: sanitizeString(payload.customerId) || null,
        interventionId: sanitizeString(payload.interventionId) || null,
      },
    })
    return respond(res, 201, created)
  }

  if (isDatabaseConfigured && (req.method === 'PATCH' || req.method === 'PUT') && url.pathname.startsWith('/api/calendar/')) {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const id = match(/^\/api\/calendar\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Evento non trovato.' })
    const payload = await readJsonBody(req)
    const updated = await prisma.calendarItem.update({
      where: { id },
      data: {
        ...(payload.title !== undefined ? { title: sanitizeString(payload.title) } : {}),
        ...(payload.description !== undefined ? { description: sanitizeString(payload.description) || null } : {}),
        ...(payload.startAt !== undefined ? { startAt: ensureDate(payload.startAt) } : {}),
        ...(payload.endAt !== undefined ? { endAt: ensureDate(payload.endAt) } : {}),
        ...(payload.status !== undefined ? { status: sanitizeString(payload.status) } : {}),
      },
    })
    return respond(res, 200, updated)
  }

  if (req.method === 'GET' && (url.pathname === '/api/customers' || url.pathname === '/api/clienti')) {
    const { q, sortColumn, order, skip, take } = parseListQuery(url, {
      defaultSort: 'created_at',
      allowedSort: ['created_at', 'updated_at', 'name', 'email', 'phone'],
    })
    const where = q ? 'WHERE lower(name) LIKE ? OR lower(email) LIKE ? OR lower(phone) LIKE ? OR lower(address) LIKE ?' : ''
    const queryParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : []
    const rows = getAll(`SELECT * FROM customers ${where} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`, [...queryParams, take, skip])
    return respond(res, 200, rows.map(mapCustomerRow))
  }
  if (req.method === 'POST' && url.pathname === '/api/customers') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
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
    if (!ensureRole(res, user, ['admin', 'tech'])) return
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
    if (!ensureRole(res, user, ['admin'])) return
    const id = match(/^\/api\/customers\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Cliente non trovato.' })
    runQuery('DELETE FROM customers WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  if (req.method === 'GET' && url.pathname === '/api/tickets') {
    const { q, sortColumn, order, skip, take } = parseListQuery(url, {
      defaultSort: 'created_at',
      allowedSort: ['created_at', 'updated_at', 'subject', 'status', 'date'],
    })
    const where = q ? 'WHERE lower(subject) LIKE ? OR lower(description) LIKE ? OR lower(customer_id) LIKE ?' : ''
    const queryParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []
    const rows = getAll(`SELECT * FROM tickets ${where} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`, [...queryParams, take, skip])
    return respond(res, 200, rows.map(mapTicketRow))
  }
  if (req.method === 'POST' && url.pathname === '/api/tickets') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
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
    if (!ensureRole(res, user, ['admin', 'tech'])) return
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
    if (!ensureRole(res, user, ['admin'])) return
    const id = match(/^\/api\/tickets\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Ticket non trovato.' })
    runQuery('DELETE FROM tickets WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  if (req.method === 'GET' && url.pathname === '/api/inventory') {
    const { q, sortColumn, order, skip, take } = parseListQuery(url, {
      defaultSort: 'created_at',
      allowedSort: ['created_at', 'updated_at', 'name', 'location', 'qty', 'price', 'min_qty'],
    })
    const where = q ? 'WHERE lower(name) LIKE ? OR lower(location) LIKE ?' : ''
    const queryParams = q ? [`%${q}%`, `%${q}%`] : []
    const rows = getAll(`SELECT * FROM inventory ${where} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`, [...queryParams, take, skip])
    return respond(res, 200, rows.map(mapInventoryRow))
  }
  if (req.method === 'POST' && url.pathname === '/api/inventory') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const payload = await readJsonBody(req)
    const { error, value } = validateInventoryPayload(payload)
    if (error) return respond(res, 400, { error })
    runQuery(
      'INSERT INTO inventory (id, name, location, qty, price, min_qty, price_date, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.name, value.location, value.qty, value.price, value.minQty, value.priceDate, nowIso(), value.updatedAt, 1],
    )
    return respond(res, 201, mapInventoryRow(getRow('SELECT * FROM inventory WHERE id = ?', [value.id])))
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/api/inventory/')) {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
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
      'UPDATE inventory SET name = ?, location = ?, qty = ?, price = ?, min_qty = ?, price_date = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.name, value.location, value.qty, value.price, value.minQty, value.priceDate, value.updatedAt, existing.version + 1, id],
    )
    return respond(res, 200, mapInventoryRow(getRow('SELECT * FROM inventory WHERE id = ?', [id])))
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/inventory/')) {
    if (!ensureRole(res, user, ['admin'])) return
    const id = match(/^\/api\/inventory\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Ricambio non trovato.' })
    runQuery('DELETE FROM inventory WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  if (req.method === 'GET' && (url.pathname === '/api/interventions' || url.pathname === '/api/chiamate' || url.pathname === '/api/riparazioni')) {
    const filters = []
    const params = []
    const type = sanitizeString(url.searchParams.get('type'))
    const typeFromPath = url.pathname === '/api/chiamate' ? 'chiamata' : (url.pathname === '/api/riparazioni' ? 'riparazione' : '')
    const status = sanitizeString(url.searchParams.get('status'))
    const clientId = sanitizeString(url.searchParams.get('clientId'))
    const urgency = sanitizeNumber(url.searchParams.get('urgency'), null)
    const from = normalizeIso(url.searchParams.get('from'))
    const to = normalizeIso(url.searchParams.get('to'))
    if (typeFromPath || type) {
      filters.push('type = ?')
      params.push(typeFromPath || type)
    }
    if (status) {
      filters.push('status = ?')
      params.push(status)
    }
    if (clientId) {
      filters.push('client_id = ?')
      params.push(clientId)
    }
    if (Number.isFinite(urgency)) {
      filters.push('urgency = ?')
      params.push(urgency)
    }
    if (from) {
      filters.push('opened_at >= ?')
      params.push(from)
    }
    if (to) {
      filters.push('opened_at <= ?')
      params.push(to)
    }
    const { q, sortColumn, order, skip, take } = parseListQuery(url, {
      defaultSort: 'opened_at',
      allowedSort: ['opened_at', 'updated_at', 'urgency', 'status', 'type', 'id'],
    })
    if (q) {
      filters.push('(lower(id) LIKE ? OR lower(description) LIKE ? OR lower(client_id) LIKE ?)')
      params.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const rows = getAll(
      `SELECT * FROM interventions ${whereClause} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`,
      [...params, take, skip],
    )
    return respond(res, 200, rows.map(mapInterventionRow))
  }

  if (req.method === 'POST' && url.pathname === '/api/interventions') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const payload = await readJsonBody(req)
    const { error, value } = validateInterventionPayload(payload)
    if (error) return respond(res, 400, { error })
    runQuery(
      'INSERT INTO interventions (id, client_id, type, status, urgency, opened_at, closed_at, description, parent_intervention_id, additional_data, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.clientId, value.type, value.status, value.urgency, value.openedAt, value.closedAt, value.description, value.parentInterventionId, value.additionalData, nowIso(), value.updatedAt, 1],
    )
    return respond(res, 201, mapInterventionRow(getRow('SELECT * FROM interventions WHERE id = ?', [value.id])))
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/interventions/')) {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const id = match(/^\/api\/interventions\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Intervento non trovato.' })
    const payload = await readJsonBody(req)
    const { error, value } = validateInterventionPayload({ ...payload, id })
    if (error) return respond(res, 400, { error })
    const existing = getRow('SELECT * FROM interventions WHERE id = ?', [id])
    if (!existing) return respond(res, 404, { error: 'Intervento non trovato.' })
    const conflictReason = resolveConflict(existing, value)
    if (conflictReason) {
      return sendConflict(res, 'Conflitto intervento: aggiorna i dati.', mapInterventionRow(existing))
    }
    runQuery(
      'UPDATE interventions SET client_id = ?, type = ?, status = ?, urgency = ?, opened_at = ?, closed_at = ?, description = ?, parent_intervention_id = ?, additional_data = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.clientId, value.type, value.status, value.urgency, value.openedAt, value.closedAt, value.description, value.parentInterventionId, value.additionalData, value.updatedAt, existing.version + 1, id],
    )
    return respond(res, 200, mapInterventionRow(getRow('SELECT * FROM interventions WHERE id = ?', [id])))
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/interventions/')) {
    if (!ensureRole(res, user, ['admin'])) return
    const id = match(/^\/api\/interventions\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Intervento non trovato.' })
    runQuery('DELETE FROM interventions WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  if (req.method === 'GET' && url.pathname === '/api/spare-parts-orders') {
    return respond(res, 200, getAll('SELECT * FROM spare_parts_orders').map(mapSparePartOrderRow))
  }
  if (req.method === 'POST' && url.pathname === '/api/spare-parts-orders') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const payload = await readJsonBody(req)
    const { error, value } = validateSparePartOrderPayload(payload)
    if (error) return respond(res, 400, { error })
    runQuery(
      'INSERT INTO spare_parts_orders (id, intervention_id, parts, status, supplier, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.interventionId, value.parts, value.status, value.supplier, value.notes, nowIso(), value.updatedAt, 1],
    )
    runQuery('UPDATE interventions SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?', ['ordine_ricambi', nowIso(), value.interventionId])
    return respond(res, 201, mapSparePartOrderRow(getRow('SELECT * FROM spare_parts_orders WHERE id = ?', [value.id])))
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/api/spare-parts-orders/')) {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const id = match(/^\/api\/spare-parts-orders\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Ordine ricambi non trovato.' })
    const payload = await readJsonBody(req)
    const { error, value } = validateSparePartOrderPayload({ ...payload, id })
    if (error) return respond(res, 400, { error })
    const existing = getRow('SELECT * FROM spare_parts_orders WHERE id = ?', [id])
    if (!existing) return respond(res, 404, { error: 'Ordine ricambi non trovato.' })
    runQuery(
      'UPDATE spare_parts_orders SET intervention_id = ?, parts = ?, status = ?, supplier = ?, notes = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.interventionId, value.parts, value.status, value.supplier, value.notes, value.updatedAt, existing.version + 1, id],
    )
    return respond(res, 200, mapSparePartOrderRow(getRow('SELECT * FROM spare_parts_orders WHERE id = ?', [id])))
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/spare-parts-orders/')) {
    if (!ensureRole(res, user, ['admin'])) return
    const id = match(/^\/api\/spare-parts-orders\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Ordine ricambi non trovato.' })
    runQuery('DELETE FROM spare_parts_orders WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  if (req.method === 'GET' && url.pathname === '/api/quotes') {
    return respond(res, 200, getAll('SELECT * FROM quotes').map(mapQuoteRow))
  }
  if (req.method === 'POST' && url.pathname === '/api/quotes') {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const payload = await readJsonBody(req)
    const { error, value } = validateQuotePayload(payload)
    if (error) return respond(res, 400, { error })
    runQuery(
      'INSERT INTO quotes (id, intervention_id, items, total_amount, discount, valid_until, status, notes, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [value.id, value.interventionId, value.items, value.totalAmount, value.discount, value.validUntil, value.status, value.notes, nowIso(), value.updatedAt, 1],
    )
    runQuery('UPDATE interventions SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?', ['preventivato', nowIso(), value.interventionId])
    return respond(res, 201, mapQuoteRow(getRow('SELECT * FROM quotes WHERE id = ?', [value.id])))
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/api/quotes/')) {
    if (!ensureRole(res, user, ['admin', 'tech'])) return
    const id = match(/^\/api\/quotes\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Preventivo non trovato.' })
    const payload = await readJsonBody(req)
    const { error, value } = validateQuotePayload({ ...payload, id })
    if (error) return respond(res, 400, { error })
    const existing = getRow('SELECT * FROM quotes WHERE id = ?', [id])
    if (!existing) return respond(res, 404, { error: 'Preventivo non trovato.' })
    runQuery(
      'UPDATE quotes SET intervention_id = ?, items = ?, total_amount = ?, discount = ?, valid_until = ?, status = ?, notes = ?, updated_at = ?, version = ? WHERE id = ?',
      [value.interventionId, value.items, value.totalAmount, value.discount, value.validUntil, value.status, value.notes, value.updatedAt, existing.version + 1, id],
    )
    if (value.status === 'accettato') {
      runQuery('UPDATE interventions SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?', ['saldato', nowIso(), value.interventionId])
    }
    return respond(res, 200, mapQuoteRow(getRow('SELECT * FROM quotes WHERE id = ?', [id])))
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/quotes/')) {
    if (!ensureRole(res, user, ['admin'])) return
    const id = match(/^\/api\/quotes\/(.+)$/)
    if (!id) return respond(res, 404, { error: 'Preventivo non trovato.' })
    runQuery('DELETE FROM quotes WHERE id = ?', [id])
    return respond(res, 204, '')
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/backup') {
    if (!ensureRole(res, user, ['admin'])) return
    if (!ensureCsrf(req, res)) return
    const result = await performBackup({ triggeredBy: 'manual-api' })
    if (!result.ok) {
      return respond(res, 503, { error: 'Backup non riuscito.', detail: result.message, lastRun: getLastBackupRun() })
    }
    return respond(res, 200, { message: 'Backup completato.', result, lastRun: getLastBackupRun() })
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/backup/latest') {
    if (!ensureRole(res, user, ['admin'])) return
    return respond(res, 200, { lastRun: getLastBackupRun() })
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/export/json') {
    if (!ensureRole(res, user, ['admin'])) return
    const payload = buildBackupPayload()
    const filename = `backup-${formatBackupTimestampForName(new Date())}.json`
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...SECURITY_HEADERS,
    })
    res.end(JSON.stringify(payload, null, 2))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/export/csv') {
    if (!ensureRole(res, user, ['admin'])) return
    const tickets = getAll('SELECT id, subject, description, customer_id, status, date, time, created_at, updated_at, version FROM tickets ORDER BY created_at ASC')
    const interventions = getAll('SELECT id, client_id, type, status, urgency, opened_at, closed_at, description, parent_intervention_id, additional_data, created_at, updated_at, version FROM interventions ORDER BY created_at ASC')

    const ticketHeaders = ['id', 'subject', 'description', 'customer_id', 'status', 'date', 'time', 'created_at', 'updated_at', 'version']
    const interventionHeaders = ['id', 'client_id', 'type', 'status', 'urgency', 'opened_at', 'closed_at', 'description', 'parent_intervention_id', 'additional_data', 'created_at', 'updated_at', 'version']

    const ticketsCsv = toCsvBuffer(ticketHeaders, tickets).toString('utf-8')
    const interventionsCsv = toCsvBuffer(interventionHeaders, interventions).toString('utf-8')
    const merged = `# tickets\n${ticketsCsv}\n# interventi\n${interventionsCsv}`

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="export-tickets-interventi.csv"',
      ...SECURITY_HEADERS,
    })

    res.end(merged)
    return
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
    handleErrorResponse(res, createHttpError(502, error?.message || 'Errore durante la chiamata a DeepSeek.', 'deepseek_proxy_error'))
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
    } catch {
      throw createHttpError(400, 'Payload JSON non valido.', 'invalid_json')
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
    handleErrorResponse(res, createHttpError(502, error?.message || 'Errore durante la chiamata RAG.', 'rag_proxy_error'))
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



const ensurePostgresSearchIndexes = async () => {
  if (!isDatabaseConfigured) return
  try {
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON "customers" USING gin ("name" gin_trgm_ops)')
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS interventions_description_trgm_idx ON "interventions" USING gin ("description" gin_trgm_ops)')
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS tickets_subject_trgm_idx ON "tickets" USING gin ("subject" gin_trgm_ops)')
  } catch (error) {
    logEvent('warn', 'postgres_search_index_setup_failed', { error: error?.message || 'unknown_error' })
  }
}

const backupIntervalMs = Math.max(1, sanitizeNumber(BACKUP_INTERVAL_HOURS, 24)) * 60 * 60 * 1000

const scheduleAutomaticBackup = () => {
  setTimeout(() => {
    performBackup({ triggeredBy: 'startup-auto' })
  }, 30_000)

  setInterval(() => {
    performBackup({ triggeredBy: 'cron-24h' })
  }, backupIntervalMs)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`)

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(req, res, url)
    }

    if (req.method === 'GET') {
      return handleStaticRequest(url.pathname, res)
    }

    return respond(res, 405, { error: 'Metodo non supportato.' })
  } catch (error) {
    handleErrorResponse(res, error, { path: req.url, method: req.method })
  }
})

ensurePostgresSearchIndexes().finally(() => {
server.listen(PORT, () => {
  logEvent('info', 'server_started', { url: `http://localhost:${PORT}` })
  if (!isProduction) {
    logEvent('info', 'default_users_available')
  }
  scheduleAutomaticBackup()
})
})
