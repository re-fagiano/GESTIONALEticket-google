import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Carica un eventuale .env locale (solo sviluppo). Le variabili già presenti vincono sempre.
const loadEnvFile = (envPath) => {
  try {
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue
      const [key, ...rest] = line.split('=')
      if (!key?.trim()) continue
      const value = rest.join('=').trim().replace(/^"|"$/g, '')
      if (!(key.trim() in process.env)) process.env[key.trim()] = value
    }
  } catch {
    // .env opzionale
  }
}

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const str = (value, fallback = '') => (typeof value === 'string' ? value.trim() : fallback) || fallback

export const loadConfig = (env = process.env, { loadDotEnv = true } = {}) => {
  if (loadDotEnv) loadEnvFile(path.join(ROOT_DIR, '.env'))
  const nodeEnv = str(env.NODE_ENV, 'development')
  return {
    ROOT_DIR,
    DIST_DIR: path.join(ROOT_DIR, 'dist'),
    PORT: num(env.PORT, 3000),
    NODE_ENV: nodeEnv,
    isProduction: nodeEnv === 'production',
    DATABASE_URL: str(env.DATABASE_URL),
    JWT_SECRET: str(env.JWT_SECRET) || str(env.JWT_ACCESS_SECRET),
    JWT_REFRESH_SECRET: str(env.JWT_REFRESH_SECRET),
    ACCESS_TOKEN_TTL_SECONDS: num(env.ACCESS_TOKEN_TTL_SECONDS, 900),
    REFRESH_TOKEN_TTL_SECONDS: num(env.REFRESH_TOKEN_TTL_SECONDS, 60 * 60 * 24 * 14),
    API_RATE_LIMIT_WINDOW_MS: num(env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    // Il vecchio limite (100 richieste / 15 min) era troppo basso per un gestionale usato tutto il giorno.
    API_RATE_LIMIT_MAX: num(env.API_RATE_LIMIT_MAX, 1500),
    LOGIN_RATE_LIMIT_WINDOW_MS: num(env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    LOGIN_RATE_LIMIT_MAX: num(env.LOGIN_RATE_LIMIT_MAX, 10),
    COOKIE_STRICT_MODE: bool(env.COOKIE_STRICT_MODE),
    ENFORCE_HTTPS: bool(env.ENFORCE_HTTPS, true),
    ENABLE_DESTRUCTIVE_OPERATIONS: bool(env.ENABLE_DESTRUCTIVE_OPERATIONS),
    ADMIN_EMAIL: str(env.ADMIN_EMAIL).toLowerCase(),
    ADMIN_PASSWORD: str(env.ADMIN_PASSWORD),
    DEEPSEEK_API_URL: str(env.DEEPSEEK_API_URL || env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com').replace(/\/$/, ''),
    DEEPSEEK_API_KEY: str(env.DEEPSEEK_API_KEY),
    RAG_API_URL: str(env.RAG_API_URL).replace(/\/$/, ''),
    BACKUP_INTERVAL_HOURS: Math.max(1, num(env.BACKUP_INTERVAL_HOURS, 24)),
    GOOGLE_DRIVE_FOLDER_NAME: str(env.GOOGLE_DRIVE_FOLDER_NAME, 'GESTIONALEticket-backups'),
    GOOGLE_DRIVE_FOLDER_ID: str(env.GOOGLE_DRIVE_FOLDER_ID),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: str(env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: str(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64: str(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64),
    // Per un account Google personale (gmail.com) i file creati da un service account occupano la sua
    // quota (0 GB): serve una cartella di un Drive condiviso oppure la delega. Vedi README.
    GOOGLE_IMPERSONATE_USER: str(env.GOOGLE_IMPERSONATE_USER),
    GOOGLE_OAUTH_CLIENT_ID: str(env.GOOGLE_OAUTH_CLIENT_ID),
    GOOGLE_OAUTH_CLIENT_SECRET: str(env.GOOGLE_OAUTH_CLIENT_SECRET),
    GOOGLE_OAUTH_REFRESH_TOKEN: str(env.GOOGLE_OAUTH_REFRESH_TOKEN),
    // URL pubblico dell'app (serve per il ritorno dal consenso Google). Se vuoto si ricava dalla richiesta.
    PUBLIC_URL: str(env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/$/, ''),
  }
}

export const validateConfig = (config) => {
  const problems = []
  if (!config.DATABASE_URL) problems.push('DATABASE_URL mancante')
  if (!config.JWT_SECRET) problems.push('JWT_SECRET mancante')
  if (!config.JWT_REFRESH_SECRET) problems.push('JWT_REFRESH_SECRET mancante')
  return problems
}
