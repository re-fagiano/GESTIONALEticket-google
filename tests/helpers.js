// Utilità per i test: crea un database Postgres temporaneo, applica tutte le migrazioni,
// avvia l'app su una porta libera e fornisce un client HTTP con cookie e token CSRF.
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createApp } from '../server/app.js'
import { loadConfig } from '../server/config.js'
import { createDb } from '../server/db.js'
import { hashPassword, generateOperatorCode } from '../server/middleware/auth.js'
import { createBackupService } from '../server/services/backup.js'
import { createGoogleClient } from '../server/services/google.js'
import { createSettings } from '../server/services/settings.js'

process.env.LOG_SILENT = '1'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgresql://postgres@localhost:5433/postgres?host=/tmp'

const withDatabase = (url, name) => {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

const psql = (url, file, { stopOnError }) => execFileSync('psql', ['-q', '-X', ...(stopOnError ? ['-v', 'ON_ERROR_STOP=1'] : []), '-d', url, '-f', file], { stdio: 'pipe' })

export const createTestDatabase = async () => {
  const name = `fixlab_test_${crypto.randomBytes(4).toString('hex')}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()
  const url = withDatabase(ADMIN_URL, name)
  const migrationsDir = path.join(ROOT, 'prisma', 'migrations')
  const migrations = readdirSync(migrationsDir).filter((entry) => /^\d+_/.test(entry)).sort()
  for (const migration of migrations) {
    const file = path.join(migrationsDir, migration, 'migration.sql')
    // Le migrazioni storiche hanno qualche istruzione che fallisce su un database vuoto
    // (es. FK verso "users" prima che la tabella esista): le applichiamo in modo tollerante,
    // mentre le migrazioni v2 devono passare senza errori.
    psql(url, file, { stopOnError: migration >= '20261125' })
  }
  const drop = async () => {
    const client = new pg.Client({ connectionString: ADMIN_URL })
    await client.connect()
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await client.end()
  }
  return { url, name, drop }
}

export const startTestApp = async ({ env = {}, fetchImpl, extensions = [] } = {}) => {
  const database = await createTestDatabase()
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    JWT_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    LOGIN_RATE_LIMIT_MAX: '1000',
    ...env,
  }, { loadDotEnv: false })
  const db = createDb(database.url, { max: 5 })
  const logger = { info() {}, warn() {}, error() {} }
  const settings = createSettings(db, config)
  const google = createGoogleClient(config, { fetchImpl, getStoredRefreshToken: () => settings.getSecret('google.oauth.refreshToken') })
  const backup = createBackupService({ db, google, config, logger })
  const app = createApp({ db, config, logger, backup, google, settings, extensions, fetchImpl })
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const createUser = async ({ email, password = 'password123', role = 'OPERATOR', approved = true, status = 'active' }) => {
    const row = await db.one(
      `INSERT INTO "users" ("id", "email", "passwordHash", "role", "operatorCode", "status", "approved", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *`,
      [crypto.randomUUID(), email, await hashPassword(password), role, generateOperatorCode(), status, approved],
    )
    return row
  }

  const client = () => {
    const jar = new Map()
    const request = async (method, url, body, { headers = {}, raw = false } = {}) => {
      const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
      const isJson = body !== undefined && typeof body !== 'string'
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          ...(jar.has('csrf_token') ? { 'x-csrf-token': decodeURIComponent(jar.get('csrf_token')) } : {}),
          ...(isJson ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: isJson ? JSON.stringify(body) : body,
        redirect: 'manual',
      })
      for (const cookie of response.headers.getSetCookie?.() || []) {
        const [pair] = cookie.split(';')
        const index = pair.indexOf('=')
        const key = pair.slice(0, index)
        const value = pair.slice(index + 1)
        if (value) jar.set(key, value)
        else jar.delete(key)
      }
      if (raw) return response
      const text = await response.text()
      let data = text
      try { data = text ? JSON.parse(text) : null } catch { /* testo */ }
      return { status: response.status, data, headers: response.headers }
    }
    const api = {
      jar,
      get: (url, opts) => request('GET', url, undefined, opts),
      post: (url, body, opts) => request('POST', url, body ?? {}, opts),
      put: (url, body, opts) => request('PUT', url, body ?? {}, opts),
      patch: (url, body, opts) => request('PATCH', url, body ?? {}, opts),
      del: (url, opts) => request('DELETE', url, undefined, opts),
      login: async (email, password = 'password123') => {
        const res = await request('POST', '/api/auth/login', { email, password })
        if (res.status !== 200) throw new Error(`login fallito: ${res.status} ${JSON.stringify(res.data)}`)
        return res
      },
    }
    return api
  }

  const loggedIn = async (role = 'ADMIN') => {
    const email = `${role.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}@test.it`
    const user = await createUser({ email, role })
    const c = client()
    await c.login(email)
    return Object.assign(c, { user })
  }

  const stop = async () => {
    backup.stop()
    for (const job of app.locals.deps.jobs || []) job.stop?.()
    await new Promise((resolve) => server.close(resolve))
    await db.close()
    await database.drop()
  }

  return { app, db, config, baseUrl, client, createUser, loggedIn, stop, deps: app.locals.deps }
}
