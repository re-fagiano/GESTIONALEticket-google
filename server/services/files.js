import crypto from 'node:crypto'
import { newId } from '../db.js'

export const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/i
export const MAX_FILE_BYTES = 15 * 1024 * 1024

export const createFileStore = ({ db, logger }) => {
  const save = async ({ buffer, fileName, mimeType, kind = 'attachment', interventionId = null, uploadedBy = null }, client = db) => {
    const id = newId()
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
    await client.query(
      `INSERT INTO "files" ("id", "fileName", "mimeType", "size", "sha256", "data", "kind", "interventionId", "uploadedBy", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [id, String(fileName || 'file').slice(0, 200), mimeType, buffer.length, sha256, buffer, kind, interventionId, uploadedBy],
    )
    return { id, fileName, mimeType, size: buffer.length }
  }

  const get = (id) => db.one('SELECT * FROM "files" WHERE "id" = $1', [id])
  const meta = (id) => db.one('SELECT "id", "fileName", "mimeType", "size", "kind", "interventionId", "createdAt" FROM "files" WHERE "id" = $1', [id])

  // Una tantum, in sottofondo: sposta gli allegati in base64 rimasti dentro additionalData nella tabella files.
  const migrateInlineAttachments = async ({ batch = 20 } = {}) => {
    let moved = 0
    for (let round = 0; round < 10_000; round += 1) {
      const rows = await db.query(
        `SELECT "id", "additionalData" FROM "interventions"
         WHERE jsonb_typeof("additionalData"->'attachments') = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements("additionalData"->'attachments') a WHERE a ? 'dataUrl')
         LIMIT $1`,
        [batch],
      )
      if (!rows.length) break
      for (const row of rows) {
        await db.tx(async (client) => {
          const list = row.additionalData.attachments
          const next = []
          for (const item of list) {
            const match = typeof item?.dataUrl === 'string' && item.dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s)
            if (!match) { const { dataUrl, ...rest } = item || {}; next.push(rest); continue } // eslint-disable-line no-unused-vars
            const buffer = Buffer.from(match[2], 'base64')
            const saved = await save({ buffer, fileName: item.fileName || item.name || 'allegato', mimeType: item.mimeType || match[1] || 'application/octet-stream', interventionId: row.id, uploadedBy: null }, client)
            next.push({ id: item.id || saved.id, fileId: saved.id, fileName: saved.fileName, mimeType: saved.mimeType, size: saved.size, uploadedAt: item.uploadedAt || null, uploadedBy: item.uploadedBy || null })
            moved += 1
          }
          await client.query(
            `UPDATE "interventions" SET "additionalData" = jsonb_set("additionalData", '{attachments}', $2::jsonb) WHERE "id" = $1`,
            [row.id, JSON.stringify(next)],
          )
        })
      }
    }
    if (moved) logger.info('inline_attachments_migrated', { moved })
    return moved
  }

  // Per il backup quotidiano: i file non ancora copiati su Drive (a blocchi, per non appesantire il backup).
  const backupProvider = async () => {
    const rows = await db.query('SELECT "id", "fileName", "mimeType", "data", "createdAt" FROM "files" WHERE "backedUpAt" IS NULL ORDER BY "createdAt" LIMIT 300')
    return rows.map((row) => ({
      fileName: `${row.createdAt.toISOString().slice(0, 10)}_${row.id.slice(0, 8)}_${row.fileName}`.replace(/[\\/:*?"<>|]/g, '_'),
      buffer: row.data,
      mimeType: row.mimeType,
      folder: 'allegati',
      onUploaded: (driveFileId) => db.query('UPDATE "files" SET "backedUpAt" = NOW(), "driveFileId" = $2 WHERE "id" = $1', [row.id, driveFileId || null]),
    }))
  }

  return { save, get, meta, migrateInlineAttachments, backupProvider }
}
