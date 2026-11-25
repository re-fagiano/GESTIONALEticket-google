import { Router } from 'express'
import { asyncHandler, badRequest, HttpError, notFound } from '../lib/errors.js'
import { escapeLike, listParams, searchTerms, str, strOrNull } from '../lib/format.js'
import { newId } from '../db.js'

const SORT = { createdAt: '"createdAt"', updatedAt: '"updatedAt"', name: 'lower("name")', email: '"email"', phone: '"phone"' }

export const customerFields = (body) => {
  const name = str(body?.name)
  if (!name) throw badRequest('Il nome cliente è obbligatorio.')
  return { name, email: strOrNull(body?.email), phone: strOrNull(body?.phone), address: strOrNull(body?.address) }
}

export const customerRoutes = ({ db, auth }) => {
  const router = Router()
  const writer = auth.requireRole('ADMIN', 'OPERATOR')

  router.get('/', asyncHandler(async (req, res) => {
    const { q, sortColumn, order, skip, take } = listParams(req.query, { allowedSort: SORT, defaultSort: 'createdAt', maxTake: 500 })
    const params = []
    const where = searchTerms(q).map((term) => {
      params.push(`%${escapeLike(term)}%`)
      const p = `$${params.length}`
      return `(lower("name") LIKE ${p} OR lower(coalesce("email",'')) LIKE ${p} OR lower(coalesce("phone",'')) LIKE ${p} OR lower(coalesce("address",'')) LIKE ${p})`
    })
    params.push(take, skip)
    const rows = await db.query(
      `SELECT * FROM "customers" ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${sortColumn} ${order}, "id" LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    res.json(rows)
  }))

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await db.one('SELECT * FROM "customers" WHERE "id" = $1', [req.params.id])
    if (!row) throw notFound('Cliente non trovato.')
    res.json(row)
  }))

  router.post('/', writer, asyncHandler(async (req, res) => {
    const fields = customerFields(req.body)
    const id = str(req.body?.id) || newId()
    const row = await db.one(
      `INSERT INTO "customers" ("id", "name", "email", "phone", "address", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "email" = EXCLUDED."email", "phone" = EXCLUDED."phone",
         "address" = EXCLUDED."address", "updatedAt" = NOW()
       RETURNING *`,
      [id, fields.name, fields.email, fields.phone, fields.address],
    )
    res.status(201).json(row)
  }))

  router.put('/:id', writer, asyncHandler(async (req, res) => {
    const fields = customerFields(req.body)
    const row = await db.one(
      'UPDATE "customers" SET "name" = $2, "email" = $3, "phone" = $4, "address" = $5, "updatedAt" = NOW() WHERE "id" = $1 RETURNING *',
      [req.params.id, fields.name, fields.email, fields.phone, fields.address],
    )
    if (!row) throw notFound('Cliente non trovato.')
    res.json(row)
  }))

  router.delete('/:id', auth.requireRole('ADMIN'), asyncHandler(async (req, res) => {
    // Gli interventi sono collegati in cascata: per non perderli per errore blocchiamo l'eliminazione.
    const linked = await db.one('SELECT COUNT(*)::int AS n FROM "interventions" WHERE "customerId" = $1', [req.params.id])
    if (linked?.n > 0) {
      throw new HttpError(409, `Il cliente ha ${linked.n} interventi collegati: non può essere eliminato.`, 'customer_has_interventions')
    }
    await db.query('DELETE FROM "customers" WHERE "id" = $1', [req.params.id])
    res.status(204).end()
  }))

  return router
}
