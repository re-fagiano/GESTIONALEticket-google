import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const loadEnvFile = () => {
  const envPath = path.join(__dirname, '.env')
  try {
    const content = readFileSync(envPath, 'utf-8')
    content.split(/\r?\n/).forEach((line) => {
      if (!line || line.trim().startsWith('#')) return
      const [key, ...rest] = line.split('=')
      if (!key) return
      const value = rest.join('=').trim().replace(/^"|"$/g, '')
      if (!(key in process.env)) {
        process.env[key] = value
      }
    })
  } catch {
    // .env opzionale
  }
}

loadEnvFile()

const rawDeepSeekUrl = process.env.DEEPSEEK_API_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const rawRagUrl = process.env.RAG_API_URL || ''

export const config = {
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEEPSEEK_API_URL: rawDeepSeekUrl.replace(/\/$/, ''),
  DEEPSEEK_API_KEY: (process.env.DEEPSEEK_API_KEY || '').trim(),
  RAG_API_URL: rawRagUrl ? rawRagUrl.replace(/\/$/, '') : '',
  API_TOKEN: (process.env.API_TOKEN || '').trim(),
  DEFAULT_TOKEN: (process.env.DEFAULT_API_TOKEN || '').trim() || crypto.randomUUID(),
  // Security hardening: non generiamo più segreti JWT random ad ogni boot.
  // Rollback: ripristinare i fallback crypto.randomBytes(...) se serve avvio senza env valorizzate.
  JWT_SECRET: (process.env.JWT_SECRET || '').trim(),
  JWT_ACCESS_SECRET: (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || '').trim(),
  JWT_REFRESH_SECRET: (process.env.JWT_REFRESH_SECRET || '').trim(),
  ACCESS_TOKEN_TTL_SECONDS: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900),
  REFRESH_TOKEN_TTL_SECONDS: Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 14),
  API_RATE_LIMIT_WINDOW_MS: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  API_RATE_LIMIT_MAX: Number(process.env.API_RATE_LIMIT_MAX || 100),
  LOGIN_RATE_LIMIT_WINDOW_MS: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  LOGIN_RATE_LIMIT_MAX: Number(process.env.LOGIN_RATE_LIMIT_MAX || 5),
  CSP_STRICT_MODE: ['1', 'true', 'yes', 'on'].includes(String(process.env.CSP_STRICT_MODE || 'false').toLowerCase()),
  COOKIE_STRICT_MODE: ['1', 'true', 'yes', 'on'].includes(String(process.env.COOKIE_STRICT_MODE || 'false').toLowerCase()),
  ENABLE_DESTRUCTIVE_OPERATIONS: ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_DESTRUCTIVE_OPERATIONS || 'false').toLowerCase()),
  REDIS_URL: (process.env.REDIS_URL || '').trim(),
  ENFORCE_HTTPS: String(process.env.ENFORCE_HTTPS || '').trim() ? ['1', 'true', 'yes', 'on'].includes(String(process.env.ENFORCE_HTTPS).toLowerCase()) : true,
  // Admin seed allineato a email/password esplicite via env.
  // Rollback: reintrodurre ADMIN_USER/ADMIN_PASS e relativa logica in server.js.
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || '').trim(),
  ADMIN_PASSWORD: (process.env.ADMIN_PASSWORD || '').trim(),
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'gestionale.db'),
  DATABASE_URL: (process.env.DATABASE_URL || '').trim(),
  BACKUP_INTERVAL_HOURS: Number(process.env.BACKUP_INTERVAL_HOURS || 24),
  GOOGLE_DRIVE_FOLDER_NAME: (process.env.GOOGLE_DRIVE_FOLDER_NAME || 'GESTIONALEticket-backups').trim(),
  GOOGLE_DRIVE_FOLDER_ID: (process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').trim(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 || '').trim(),
}
