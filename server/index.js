import { loadConfig, validateConfig } from './config.js'
import { createDb } from './db.js'
import { logger } from './lib/logger.js'
import { createApp } from './app.js'
import { ensureAdminUser } from './routes/auth.js'
import { createBackupService } from './services/backup.js'
import { createGoogleClient } from './services/google.js'
import { createSettings } from './services/settings.js'
import { extensions as loadExtensions } from './extensions.js'

const config = loadConfig()
const problems = validateConfig(config)
if (problems.length) {
  // Senza database o segreti JWT l'app non può funzionare in modo sicuro: meglio fermarsi subito
  // con un messaggio chiaro che partire "a metà" come faceva il vecchio server.
  logger.error('config_invalid', { problems })
  process.exit(1)
}

const db = createDb(config.DATABASE_URL)
const settings = createSettings(db, config)
const google = createGoogleClient(config, { getStoredRefreshToken: () => settings.getSecret('google.oauth.refreshToken').catch(() => '') })
const backup = createBackupService({ db, google, config, logger })
const app = createApp({ db, config, logger, backup, google, settings, extensions: loadExtensions })

const start = async () => {
  await db.query('SELECT 1')
  await ensureAdminUser({ db, config, logger }).catch((error) => logger.warn('admin_seed_failed', { error: error.message }))
  const server = app.listen(config.PORT, () => logger.info('server_started', { port: config.PORT, env: config.NODE_ENV }))
  backup.schedule()
  for (const job of app.locals.deps.jobs || []) job.start?.()

  const shutdown = (signal) => {
    logger.info('server_stopping', { signal })
    backup.stop()
    for (const job of app.locals.deps.jobs || []) job.stop?.()
    server.close(() => db.close().finally(() => process.exit(0)))
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

process.on('unhandledRejection', (error) => logger.error('unhandled_rejection', { error: error?.message, stack: error?.stack }))

start().catch((error) => {
  logger.error('startup_failed', { error: error.message })
  process.exit(1)
})
