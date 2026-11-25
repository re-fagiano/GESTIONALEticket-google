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

const RETENTION_DAYS = 90

export const createBackupService = ({ db, google, config, logger }) => {
  // Altri file da salvare insieme al backup del database (es. il Google Calendar).
  // Ogni provider restituisce [{ fileName, buffer, mimeType }].
  const providers = []
  const addProvider = (provider) => providers.push(provider)
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

  const upload = async ({ fileName, buffer, folderId, mimeType = 'application/json' }) => {
    const boundary = `fixlab-${Date.now()}`
    const metadata = JSON.stringify({ name: fileName, mimeType, ...(folderId ? { parents: [folderId] } : {}) })
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
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

  // Cancella dalla cartella i backup più vecchi di 90 giorni (solo file creati da questa app).
  const prune = async (folderId) => {
    if (!folderId) return 0
    const before = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and createdTime < '${before}' and (name contains 'backup-' or name contains 'calendario-')`)
    const list = await google.request({ scopes: GOOGLE_SCOPES.drive, url: `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true` })
    let removed = 0
    for (const file of list?.files || []) {
      await google.request({ scopes: GOOGLE_SCOPES.drive, method: 'DELETE', url: `/drive/v3/files/${file.id}?supportsAllDrives=true` }).catch(() => {})
      removed += 1
    }
    return removed
  }

  const perform = async ({ triggeredBy = 'manual', context = {} } = {}) => {
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
      const extraFiles = []
      const extraErrors = []
      for (const provider of providers) {
        try {
          for (const file of (await provider(context)) || []) {
            const saved = await upload({ ...file, folderId })
            extraFiles.push({ fileName: file.fileName, driveFileId: saved?.id || '' })
          }
        } catch (error) {
          extraErrors.push(error.message)
          logger.error('backup_extra_failed', { error: error.message })
        }
      }
      const pruned = await prune(folderId).catch(() => 0)
      const allNames = [fileName, ...extraFiles.map((f) => f.fileName)].join(', ')
      if (extraErrors.length) {
        const message = `Database salvato, ma backup del calendario non riuscito: ${extraErrors[0]}`
        await storeRun({ status: 'failed', fileName: allNames, driveFileId: created?.id || null, errorMessage: message })
        return { ok: false, mode: 'failed', fileName, exportedAt: payload.exportedAt, message, extraFiles }
      }
      await storeRun({ status: 'success', fileName: allNames, driveFileId: created?.id || null })
      logger.info('backup_completed', { triggeredBy, files: allNames, pruned })
      return { ok: true, mode: 'drive', fileName, exportedAt: payload.exportedAt, driveFileId: created?.id || '', extraFiles, pruned }
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

  // Controllo orario: se l'ultimo backup (riuscito, o saltato perché Google non è collegato) è più vecchio dell'intervallo (default 24 ore) ne facciamo uno.
  // Così il backup resta quotidiano anche se Railway riavvia spesso il server; se fallisce si riprova ogni ora.
  const runIfDue = async (triggeredBy) => {
    try {
      const row = await db.one(`SELECT "createdAt" FROM "backup_runs" WHERE "status" IN ('success', 'not_configured') ORDER BY "createdAt" DESC LIMIT 1`)
      const ageHours = row ? (Date.now() - new Date(row.createdAt).getTime()) / 3600_000 : Infinity
      if (ageHours >= config.BACKUP_INTERVAL_HOURS - 0.5) await perform({ triggeredBy })
    } catch (error) {
      logger.error('backup_schedule_failed', { error: error.message })
    }
  }

  let timers = []
  const schedule = () => {
    timers.push(setTimeout(() => runIfDue('startup-auto'), 60_000))
    timers.push(setInterval(() => runIfDue('scheduled'), 3600_000))
    timers.forEach((t) => t.unref?.())
  }
  const stop = () => { timers.forEach((t) => { clearTimeout(t); clearInterval(t) }); timers = [] }

  return { buildPayload, perform, lastRun, schedule, stop, addProvider, runIfDue }
}
