import express, { Router } from 'express'
import { asyncHandler, badRequest, notFound } from '../lib/errors.js'
import { str } from '../lib/format.js'
import { ALLOWED_MIME, MAX_FILE_BYTES } from '../services/files.js'

// Upload: corpo binario (non JSON), nome e tipo nei parametri. Download: stream del file.
export const fileRoutes = ({ files, auth }) => {
  const router = Router()

  router.post('/', auth.requireRole('ADMIN', 'OPERATOR'), express.raw({ type: () => true, limit: MAX_FILE_BYTES }), asyncHandler(async (req, res) => {
    const mimeType = str(req.query.type || req.headers['content-type']).split(';')[0].toLowerCase()
    if (!ALLOWED_MIME.test(mimeType)) throw badRequest('Tipo di file non ammesso (solo foto e PDF).', 'file_type')
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('File vuoto.', 'file_empty')
    const kind = ['attachment', 'signature', 'logo'].includes(str(req.query.kind)) ? str(req.query.kind) : 'attachment'
    const saved = await files.save({
      buffer: req.body,
      fileName: str(req.query.name, 'file'),
      mimeType,
      kind,
      interventionId: str(req.query.interventionId) || null,
      uploadedBy: req.user.id,
    })
    res.status(201).json(saved)
  }))

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await files.get(req.params.id)
    if (!row) throw notFound('File non trovato.')
    res.setHeader('Content-Type', row.mimeType)
    res.setHeader('Content-Length', String(row.size))
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.setHeader('Content-Disposition', `${str(req.query.download) === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`)
    res.end(row.data)
  }))

  return router
}
