import { GOOGLE_SCOPES } from './google.js'
import { newId } from '../db.js'

// Tutte le tabelle con dati di lavoro. (Il vecchio backup ometteva calendario, note e storico.)
export const BACKUP_TABLES = {
  users: 'SELECT "id", "email", "passwordHash", "role", "operatorCode", "status", "approved", "createdAt", "updatedAt" FROM "users" ORDER BY "createdAt"',
  customers: 'SELECT * FROM "customers" ORDER BY "createdAt"',
  tickets: 'SELECT * FROM "tickets" ORDER BY "createdAt"',
  interventions: 'SELECT * FROM "interventions" ORDER BY "createdAt"',
  interventionLogs: 'SELECT * FROM "intervento_logs" ORDER BY "createdAt"',
  notes: 'SELECT * FROM "notes" ORDER BY "createdAt"',
  calendarItems: 'SELECT * FROM "calendar_items" ORDER BY "createdAt"',
  inventory: 'SELECT * FROM "inventory" ORDER BY "createdAt"',
  inventoryMovements: 'SELECT * FROM "inventory_movements" ORDER BY "createdAt"',
}

const stamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
}

export const createBackupService = ({ db, google, config, logger }) => {
  const buildPayload = async () => {
    const entries = await Promise.all(Object.entries(BACKUP_TABLES).map(async ([name, sql]) => [name, await db.query(sql)]))
    return { exportedAt: new Date().toISOString(), source: 'server', format: 'fixlab-v2', ...Object.fromEntries(entries) }
  }

  const storeRun = async ({ status, fileName = null, driveFileId = null, errorMessage = null }) => {
    await db.query(
      'INSERT INTO "backup_runs" ("id", "status", "fileName", "driveFileId", "errorMessage", "createdAt") VALUES ($1, $2, $3, $4, $5, NOW())',
      [newId(), status, fileName, driveFileId, errorMessage],
    )
  }

  const lastRun = async () => {
    const row = await db.one('SELECT * FROM "backup_runs" ORDER BY "createdAt" DESC LIMIT 1')
    if (!row) return null
    // Formato snake_case atteso dall'interfaccia attuale.
    return { id: row.id, status: row.status, file_name: row.fileName, drive_file_id: row.driveFileId, error_message: row.errorMessage, created_at: row.createdAt }
  }

  const ensureFolder = async () => {
    if (config.GOOGLE_DRIVE_FOLDER_ID) return config.GOOGLE_DRIVE_FOLDER_ID
    const name = config.GOOGLE_DRIVE_FOLDER_NAME.replace(/'/g, "\\'")
    const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
    const existing = await google.request({ scopes: GOOGLE_SCOPES.drive, url: `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true` })
    if (existing?.files?.length) return existing.files[0].id
    const created = await google.request({
      scopes: GOOGLE_SCOPES.drive,
      method: 'POST',
      url: '/drive/v3/files?fields=id&supportsAllDrives=true',
      body: { name: config.GOOGLE_DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
    })
    return created?.id || ''
  }

  const upload = async ({ fileName, buffer, folderId }) => {
    const boundary = `fixlab-${Date.now()}`
    const metadata = JSON.stringify({ name: fileName, mimeType: 'application/json', ...(folderId ? { parents: [folderId] } : {}) })
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ])
    return google.request({
      scopes: GOOGLE_SCOPES.drive,
      method: 'POST',
      url: '/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true',
      body,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    })
  }

  const perform = async ({ triggeredBy = 'manual' } = {}) => {
    const fileName = `backup-${stamp()}.json`
    let payload
    try {
      payload = await buildPayload()
    } catch (error) {
      logger.error('backup_payload_failed', { error: error.message })
      await storeRun({ status: 'failed', fileName, errorMessage: error.message }).catch(() => {})
      return { ok: false, mode: 'failed', fileName, message: error.message }
    }

    const mode = await google.getMode()
    if (mode === 'none') {
      // Prima questo caso veniva chiamato "degraded" e sembrava un backup riuscito a metà: in realtà
      // il file non veniva salvato da nessuna parte. Ora lo diciamo chiaramente.
      const message = 'Google Drive non collegato: il backup automatico NON è stato salvato. Collega Google nelle Impostazioni o usa "Export JSON".'
      await storeRun({ status: 'not_configured', fileName, errorMessage: message })
      logger.warn('backup_not_configured', { triggeredBy })
      return { ok: true, mode: 'not_configured', fileName, exportedAt: payload.exportedAt, message }
    }

    try {
      const folderId = await ensureFolder()
      const created = await upload({ fileName, buffer: Buffer.from(JSON.stringify(payload)), folderId })
      await storeRun({ status: 'success', fileName, driveFileId: created?.id || null })
      logger.info('backup_completed', { triggeredBy, fileName, mode })
      return { ok: true, mode: 'drive', fileName, exportedAt: payload.exportedAt, driveFileId: created?.id || '' }
    } catch (error) {
      let message = error.message || 'Errore backup sconosciuto'
      if (/storage quota/i.test(message)) {
        message = 'Il service account non ha spazio su Drive (account Gmail personale). Usa "Collega Google" nelle Impostazioni.'
      }
      await storeRun({ status: 'failed', fileName, errorMessage: message }).catch(() => {})
      logger.error('backup_failed', { triggeredBy, error: message })
      return { ok: false, mode: 'failed', fileName, exportedAt: payload.exportedAt, message }
    }
  }

  let timers = []
  const schedule = () => {
    timers.push(setTimeout(() => perform({ triggeredBy: 'startup-auto' }), 60_000))
    timers.push(setInterval(() => perform({ triggeredBy: 'scheduled' }), config.BACKUP_INTERVAL_HOURS * 3600_000))
    timers.forEach((t) => t.unref?.())
  }
  const stop = () => { timers.forEach((t) => { clearTimeout(t); clearInterval(t) }); timers = [] }

  return { buildPayload, perform, lastRun, schedule, stop }
}
