import crypto from 'node:crypto'
import { Router } from 'express'
import { asyncHandler, badRequest, notFound } from '../lib/errors.js'
import { dateOr, escapeAngles, escapeLike, int, iso, listParams, searchTerms, str, strOrNull } from '../lib/format.js'
import { newId } from '../db.js'

export const INTERVENTION_TYPES = ['chiamata', 'riparazione', 'ordine_ricambi', 'preventivo']
export const INTERVENTION_STATUSES = ['pendente', 'in_lavorazione', 'completato', 'annullato']
const CLOSED = new Set(['completato', 'annullato'])
const SORT = { openedAt: 'i."openedAt"', updatedAt: 'i."updatedAt"', priority: 'i."priority"', status: 'i."status"', type: 'i."type"', code: 'i."code"', opened_at: 'i."openedAt"' }

export const mapIntervention = (row, logs = []) => {
  if (!row) return null
  const opened = row.openedAt ? new Date(row.openedAt).getTime() : null
  const closed = row.closedAt ? new Date(row.closedAt).getTime() : Date.now()
  return {
    id: row.id,
    code: row.code,
    clientId: row.customerId,
    customerId: row.customerId,
    ...(row.customerName !== undefined ? { customerName: row.customerName } : {}),
    type: row.type,
    status: row.status,
    urgency: row.priority,
    priority: row.priority,
    assignedToId: row.assignedToId || '',
    openedAt: iso(row.openedAt),
    closedAt: iso(row.closedAt),
    description: escapeAngles(row.description || ''),
    additionalData: row.additionalData || {},
    logs: logs.map((log) => ({ id: log.id, interventoId: log.interventoId, userId: log.userId || '', action: log.action, note: log.note || '', createdAt: iso(log.createdAt) })),
    durationDays: opened ? Math.max(0, Math.ceil((closed - opened) / 86_400_000)) : 0,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    version: row.version,
  }
}

const newCode = () => {
  const d = new Date()
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  return `INV-${ymd}-${crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')}`
}

const parseUrgency = (value, fallback = 2) => {
  const urgency = int(value, fallback)
  if (![1, 2, 3].includes(urgency)) throw badRequest('Urgenza non valida (1, 2, 3).')
  return urgency
}

export const interventionRoutes = ({ db, auth, hooks = {} }) => {
  const router = Router()
  const writer = auth.requireRole('ADMIN', 'OPERATOR')

  const log = (client, interventoId, userId, action, note = '') => client.query(
    'INSERT INTO "intervento_logs" ("id", "interventoId", "userId", "action", "note", "createdAt") VALUES ($1, $2, $3, $4, $5, NOW())',
    [newId(), interventoId, userId || null, action, note],
  )

  const load = async (id) => {
    const row = await db.one('SELECT * FROM "interventions" WHERE "id" = $1', [id])
    if (!row) return null
    const logs = await db.query('SELECT * FROM "intervento_logs" WHERE "interventoId" = $1 ORDER BY "createdAt"', [id])
    return mapIntervention(row, logs)
  }

  const validUserId = async (client, value) => {
    const id = str(value)
    if (!id) return null
    return (await client.one('SELECT 1 FROM "users" WHERE "id" = $1', [id])) ? id : null
  }

  const notify = (event, id) => { Promise.resolve(hooks.onChange?.(event, id)).catch(() => {}) }

  const list = (forcedType) => asyncHandler(async (req, res) => {
    const { q, sortColumn, order, skip, take } = listParams(req.query, { allowedSort: SORT, defaultSort: 'openedAt', maxTake: 500 })
    const params = []
    const where = []
    const type = forcedType || str(req.query.type)
    if (INTERVENTION_TYPES.includes(type)) { params.push(type); where.push(`i."type" = $${params.length}`) }
    const status = str(req.query.status)
    if (INTERVENTION_STATUSES.includes(status)) { params.push(status); where.push(`i."status" = $${params.length}`) }
    if (str(req.query.open) === '1') where.push(`i."status" IN ('pendente', 'in_lavorazione')`)
    const customerId = str(req.query.customerId || req.query.clientId)
    if (customerId) { params.push(customerId); where.push(`i."customerId" = $${params.length}`) }
    const urgency = int(req.query.urgency, 0)
    if ([1, 2, 3].includes(urgency)) { params.push(urgency); where.push(`i."priority" = $${params.length}`) }
    const assignedToId = str(req.query.assignedToId)
    if (assignedToId === 'none') where.push('i."assignedToId" IS NULL')
    else if (assignedToId) { params.push(assignedToId); where.push(`i."assignedToId" = $${params.length}`) }
    const from = iso(req.query.from)
    if (from) { params.push(from); where.push(`i."openedAt" >= $${params.length}`) }
    const to = iso(req.query.to)
    if (to) { params.push(to); where.push(`i."openedAt" <= $${params.length}`) }
    for (const term of searchTerms(q)) {
      params.push(`%${escapeLike(term)}%`)
      const p = `$${params.length}`
      where.push(`(lower(i."code") LIKE ${p} OR lower(coalesce(i."description",'')) LIKE ${p} OR lower(c."name") LIKE ${p})`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    if (str(req.query.withTotal) === '1') {
      const total = await db.one(`SELECT COUNT(*)::int AS n FROM "interventions" i JOIN "customers" c ON c."id" = i."customerId" ${whereSql}`, params)
      res.setHeader('X-Total-Count', String(total?.n ?? 0))
    }
    // Gli allegati (base64) possono essere pesanti: nell'elenco mandiamo solo il loro numero.
    const light = str(req.query.light) === '1'
    params.push(take, skip)
    const rows = await db.query(
      `SELECT i.*, c."name" AS "customerName", c."phone" AS "customerPhone" FROM "interventions" i JOIN "customers" c ON c."id" = i."customerId"
       ${whereSql}
       ORDER BY ${sortColumn} ${order}, i."id" LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    res.json(rows.map((row) => {
      const mapped = mapIntervention(row)
      if (row.customerPhone !== undefined) mapped.customerPhone = row.customerPhone || ''
      if (light && mapped.additionalData) {
        const { attachments, files, ...rest } = mapped.additionalData
        const count = (Array.isArray(attachments) ? attachments.length : 0) + (Array.isArray(files) ? files.length : 0)
        mapped.additionalData = { ...rest, attachmentsCount: count }
      }
      return mapped
    }))
  })

  // Contatori per la dashboard (aperti per tipo, urgenti, da assegnare, appuntamenti di oggi).
  router.get('/interventions/stats', asyncHandler(async (req, res) => {
    const rows = await db.query(`
      SELECT "type",
             COUNT(*) FILTER (WHERE "status" IN ('pendente','in_lavorazione'))::int AS "open",
             COUNT(*) FILTER (WHERE "status" IN ('pendente','in_lavorazione') AND "priority" = 3)::int AS "urgent",
             COUNT(*) FILTER (WHERE "status" IN ('pendente','in_lavorazione') AND "assignedToId" IS NULL)::int AS "unassigned",
             COUNT(*) FILTER (WHERE "status" = 'completato' AND "closedAt" >= date_trunc('month', NOW()))::int AS "closedThisMonth",
             COUNT(*)::int AS "total"
      FROM "interventions" GROUP BY "type"`)
    res.json(Object.fromEntries(rows.map((row) => [row.type, row])))
  }))

  router.get('/interventions', list())
  router.get('/chiamate', list('chiamata'))
  router.get('/riparazioni', list('riparazione'))

  router.get('/interventions/:id', asyncHandler(async (req, res) => {
    const found = await load(req.params.id)
    if (!found) throw notFound('Intervento non trovato.')
    res.json(found)
  }))

  router.post('/interventions', writer, asyncHandler(async (req, res) => {
    const body = req.body || {}
    const customerId = str(body.clientId || body.customerId)
    if (!customerId) throw badRequest('Il client_id è obbligatorio.')
    const type = str(body.type)
    if (!INTERVENTION_TYPES.includes(type)) throw badRequest('Tipo intervento non valido.')
    const status = str(body.status, 'pendente')
    if (!INTERVENTION_STATUSES.includes(status)) throw badRequest('Stato intervento non valido.')
    const urgency = parseUrgency(body.urgency ?? body.priority)
    const additionalData = body.additionalData && typeof body.additionalData === 'object' ? body.additionalData : {}

    const id = await db.tx(async (client) => {
      if (!(await client.one('SELECT 1 FROM "customers" WHERE "id" = $1', [customerId]))) throw badRequest('Cliente non trovato.', 'customer_not_found')
      const interventionId = str(body.id) || newId()
      const existing = await client.one('SELECT "id" FROM "interventions" WHERE "id" = $1', [interventionId])
      if (existing) return interventionId // reinvio dello stesso intervento (retry): idempotente
      await client.query(
        `INSERT INTO "interventions" ("id", "code", "customerId", "type", "status", "priority", "assignedToId", "description",
           "openedAt", "closedAt", "additionalData", "version", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, NOW(), NOW())`,
        [interventionId, newCode(), customerId, type, status, urgency, await validUserId(client, body.assignedToId || body.assignedTo),
          strOrNull(body.description), dateOr(body.openedAt), iso(body.closedAt) ? new Date(body.closedAt) : (CLOSED.has(status) ? new Date() : null), additionalData],
      )
      await log(client, interventionId, req.user.id, 'intervento_creato', str(body.description))
      return interventionId
    })
    notify('upsert', id)
    res.status(201).json(await load(id))
  }))

  const update = asyncHandler(async (req, res) => {
    const id = req.params.id
    const body = req.body || {}
    await db.tx(async (client) => {
      const current = await client.one('SELECT * FROM "interventions" WHERE "id" = $1 FOR UPDATE', [id])
      if (!current) throw notFound('Intervento non trovato.')
      const set = {}
      const logs = []

      const partialKeys = ['status', 'priority', 'urgency', 'assignedToId', 'assignedTo', 'description', 'notes', 'note', 'additionalData', 'openedAt']
      const isPartial = partialKeys.some((key) => body[key] !== undefined) && body.type === undefined

      if (isPartial) {
        if (body.status !== undefined) {
          if (!INTERVENTION_STATUSES.includes(body.status)) throw badRequest('Stato intervento non valido.')
          if (body.status !== current.status) logs.push(['status_changed', `Nuovo stato: ${body.status}`])
          set.status = body.status
        }
        if (body.priority !== undefined || body.urgency !== undefined) set.priority = parseUrgency(body.priority ?? body.urgency)
        if (body.assignedToId !== undefined || body.assignedTo !== undefined) {
          set.assignedToId = await validUserId(client, body.assignedToId || body.assignedTo)
          logs.push(['assigned_operator', set.assignedToId || 'assegnazione rimossa'])
        }
        if (body.description !== undefined) set.description = strOrNull(body.description)
        if (body.additionalData && typeof body.additionalData === 'object') set.additionalData = body.additionalData
        if (body.openedAt !== undefined) set.openedAt = dateOr(body.openedAt, current.openedAt)
      } else {
        const customerId = str(body.clientId || body.customerId, current.customerId)
        if (!(await client.one('SELECT 1 FROM "customers" WHERE "id" = $1', [customerId]))) throw badRequest('Cliente non trovato.', 'customer_not_found')
        const type = str(body.type, current.type)
        if (!INTERVENTION_TYPES.includes(type)) throw badRequest('Tipo intervento non valido.')
        const status = str(body.status, current.status)
        if (!INTERVENTION_STATUSES.includes(status)) throw badRequest('Stato intervento non valido.')
        if (status !== current.status) logs.push(['status_changed', `Nuovo stato: ${status}`])
        Object.assign(set, {
          customerId,
          type,
          status,
          priority: parseUrgency(body.urgency ?? body.priority, current.priority),
          description: body.description !== undefined ? strOrNull(body.description) : current.description,
          openedAt: dateOr(body.openedAt, current.openedAt),
          additionalData: body.additionalData && typeof body.additionalData === 'object' ? body.additionalData : current.additionalData,
        })
        if (body.closedAt !== undefined) set.closedAt = iso(body.closedAt) ? new Date(body.closedAt) : null
      }

      // Data di chiusura automatica coerente con lo stato.
      if (set.status && set.closedAt === undefined) {
        if (CLOSED.has(set.status) && !current.closedAt) set.closedAt = new Date()
        if (!CLOSED.has(set.status) && current.closedAt) set.closedAt = null
      }

      const keys = Object.keys(set)
      if (keys.length) {
        const assignments = keys.map((key, index) => `"${key}" = $${index + 2}`)
        await client.query(
          `UPDATE "interventions" SET ${assignments.join(', ')}, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = $1`,
          [id, ...keys.map((key) => set[key])],
        )
      }
      if (str(body.notes)) await client.query('INSERT INTO "notes" ("id", "interventionId", "content", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())', [newId(), id, str(body.notes)])
      if (str(body.note)) logs.push(['note_added', str(body.note)])
      for (const [action, note] of logs) await log(client, id, req.user.id, action, note)
    })
    notify('upsert', id)
    res.json({ ...(await load(id)), updatedByUserId: req.user.id })
  })

  router.put('/interventions/:id', writer, update)
  router.patch('/interventions/:id', writer, update)
  router.patch('/interventi/:id', writer, update)

  router.delete('/interventions/:id', auth.requireRole('ADMIN'), asyncHandler(async (req, res) => {
    await db.query('DELETE FROM "interventions" WHERE "id" = $1', [req.params.id])
    notify('delete', req.params.id)
    res.status(204).end()
  }))

  // Converte una chiamata in riparazione. Accetta sia un intervento di tipo "chiamata"
  // sia un vecchio "ticket" (l'interfaccia attuale passa l'id del ticket).
  router.post('/riparazioni/from-chiamata/:id', writer, asyncHandler(async (req, res) => {
    const sourceId = req.params.id
    const createdId = await db.tx(async (client) => {
      const call = await client.one('SELECT * FROM "interventions" WHERE "id" = $1 FOR UPDATE', [sourceId])
      const ticket = call ? null : await client.one('SELECT * FROM "tickets" WHERE "id" = $1 FOR UPDATE', [sourceId])
      if ((!call || call.type !== 'chiamata') && !ticket) throw notFound('Chiamata non trovata.')
      const customerId = call?.customerId || ticket?.customerId
      if (!customerId) throw badRequest('La chiamata non ha un cliente associato.', 'customer_required')
      const repairId = newId()
      await client.query(
        `INSERT INTO "interventions" ("id", "code", "customerId", "type", "status", "priority", "assignedToId", "description",
           "openedAt", "additionalData", "version", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'riparazione', 'pendente', $4, $5, $6, NOW(), $7, 1, NOW(), NOW())`,
        [repairId, newCode(), customerId, call?.priority || 2, call?.assignedToId || null,
          call?.description || [ticket?.subject, ticket?.description].filter(Boolean).join(' — ') || null,
          { ...(call?.additionalData || {}), ...(ticket ? { legacyTicketId: ticket.id, subject: ticket.subject } : {}) }],
      )
      if (call) {
        await client.query(`UPDATE "interventions" SET "status" = 'completato', "closedAt" = NOW(), "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = $1`, [call.id])
        await log(client, call.id, req.user.id, 'converted_to_repair', `Riparazione creata: ${repairId}`)
      } else {
        await client.query(`UPDATE "tickets" SET "status" = 'chiuso', "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = $1`, [ticket.id])
      }
      await log(client, repairId, req.user.id, 'created_from_call', `Da chiamata: ${sourceId}`)
      return repairId
    })
    notify('upsert', createdId)
    if (sourceId) notify('upsert', sourceId)
    res.status(201).json(await load(createdId))
  }))

  return router
}
