import { Router } from 'express'
import { asyncHandler, badRequest } from '../lib/errors.js'
import { escapeAngles, escapeLike, listParams, searchTerms, str, strOrNull } from '../lib/format.js'
import { newId } from '../db.js'

const SORT = { created_at: '"createdAt"', createdAt: '"createdAt"', updated_at: '"updatedAt"', updatedAt: '"updatedAt"', subject: 'lower("subject")', status: '"status"', date: '"date"' }

const mapTicket = (row) => ({ ...row, subject: escapeAngles(row.subject), description: escapeAngles(row.description || '') })

const ticketFields = (body) => {
  const subject = str(body?.subject)
  if (!subject) throw badRequest('Oggetto ticket obbligatorio.')
  return {
    subject,
    description: strOrNull(body?.description),
    status: str(body?.status, 'aperto'),
    date: strOrNull(body?.date),
    time: strOrNull(body?.time),
    customerId: strOrNull(body?.customerId),
  }
}

// I ticket prima finivano in un file SQLite sul disco temporaneo del server (cancellato a ogni deploy).
// Ora sono su Postgres. PUT fa "upsert": così i ticket rimasti solo nella cache del browser
// vengono salvati sul server alla prima modifica, invece di dare errore 404.
export const ticketRoutes = ({ db, auth }) => {
  const router = Router()
  const writer = auth.requireRole('ADMIN', 'OPERATOR')

  const customerExists = async (id) => !id || Boolean(await db.one('SELECT 1 FROM "customers" WHERE "id" = $1', [id]))

  const upsert = async (id, fields) => db.one(
    `INSERT INTO "tickets" ("id", "subject", "description", "status", "date", "time", "customerId", "version", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW(), NOW())
     ON CONFLICT ("id") DO UPDATE SET "subject" = EXCLUDED."subject", "description" = EXCLUDED."description",
       "status" = EXCLUDED."status", "date" = EXCLUDED."date", "time" = EXCLUDED."time", "customerId" = EXCLUDED."customerId",
       "version" = "tickets"."version" + 1, "updatedAt" = NOW()
     RETURNING *`,
    [id, fields.subject, fields.description, fields.status, fields.date, fields.time, (await customerExists(fields.customerId)) ? fields.customerId : null],
  )

  router.get('/', asyncHandler(async (req, res) => {
    const { q, sortColumn, order, skip, take } = listParams(req.query, { allowedSort: SORT, defaultSort: 'createdAt', maxTake: 500 })
    const params = []
    const where = searchTerms(q).map((term) => {
      params.push(`%${escapeLike(term)}%`)
      return `(lower("subject") LIKE $${params.length} OR lower(coalesce("description",'')) LIKE $${params.length})`
    })
    params.push(take, skip)
    const rows = await db.query(
      `SELECT * FROM "tickets" ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${sortColumn} ${order}, "id" LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    res.json(rows.map(mapTicket))
  }))

  router.post('/', writer, asyncHandler(async (req, res) => {
    res.status(201).json(mapTicket(await upsert(str(req.body?.id) || newId(), ticketFields(req.body))))
  }))

  router.put('/:id', writer, asyncHandler(async (req, res) => {
    res.json(mapTicket(await upsert(req.params.id, ticketFields(req.body))))
  }))

  router.delete('/:id', auth.requireRole('ADMIN'), asyncHandler(async (req, res) => {
    await db.query('DELETE FROM "tickets" WHERE "id" = $1', [req.params.id])
    res.status(204).end()
  }))

  return router
}
