import { Router } from 'express'
import { asyncHandler, badRequest, notFound } from '../lib/errors.js'
import { dateOr, iso, str, strOrNull } from '../lib/format.js'
import { newId } from '../db.js'

export const calendarRoutes = ({ db, auth, hooks = {} }) => {
  const router = Router()
  const writer = auth.requireRole('ADMIN', 'OPERATOR')
  const notify = (event, id) => { Promise.resolve(hooks.onChange?.(event, id)).catch(() => {}) }

  router.get('/', asyncHandler(async (req, res) => {
    const from = iso(req.query.from)
    const to = iso(req.query.to)
    const params = []
    const where = []
    if (from) { params.push(from); where.push(`"endAt" >= $${params.length}`) }
    if (to) { params.push(to); where.push(`"startAt" <= $${params.length}`) }
    const rows = await db.query(`SELECT * FROM "calendar_items" ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY "startAt" LIMIT 5000`, params)
    res.json(rows)
  }))

  router.post('/', writer, asyncHandler(async (req, res) => {
    const title = str(req.body?.title)
    if (!title) throw badRequest('title obbligatorio.')
    const startAt = dateOr(req.body?.startAt || req.body?.from)
    const endAt = dateOr(req.body?.endAt || req.body?.to, new Date(startAt.getTime() + 3600_000))
    if (endAt < startAt) throw badRequest("L'orario di fine è prima dell'inizio.")
    const row = await db.one(
      `INSERT INTO "calendar_items" ("id", "title", "description", "startAt", "endAt", "status", "customerId", "interventionId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING *`,
      [newId(), title, strOrNull(req.body?.description), startAt, endAt, str(req.body?.status, 'planned'), strOrNull(req.body?.customerId), strOrNull(req.body?.interventionId)],
    )
    notify('upsert', row.id)
    res.status(201).json(row)
  }))

  const update = asyncHandler(async (req, res) => {
    const current = await db.one('SELECT * FROM "calendar_items" WHERE "id" = $1', [req.params.id])
    if (!current) throw notFound('Evento non trovato.')
    const body = req.body || {}
    const startAt = body.startAt !== undefined ? dateOr(body.startAt, current.startAt) : current.startAt
    const endAt = body.endAt !== undefined ? dateOr(body.endAt, current.endAt) : current.endAt
    if (endAt < startAt) throw badRequest("L'orario di fine è prima dell'inizio.")
    const row = await db.one(
      `UPDATE "calendar_items" SET "title" = $2, "description" = $3, "startAt" = $4, "endAt" = $5, "status" = $6, "updatedAt" = NOW()
       WHERE "id" = $1 RETURNING *`,
      [current.id, body.title !== undefined ? str(body.title) || current.title : current.title,
        body.description !== undefined ? strOrNull(body.description) : current.description,
        startAt, endAt, body.status !== undefined ? str(body.status) : current.status],
    )
    notify('upsert', row.id)
    res.json(row)
  })
  router.patch('/:id', writer, update)
  router.put('/:id', writer, update)

  router.delete('/:id', writer, asyncHandler(async (req, res) => {
    notify('delete', req.params.id)
    await db.query('DELETE FROM "calendar_items" WHERE "id" = $1', [req.params.id])
    res.status(204).end()
  }))

  return router
}
