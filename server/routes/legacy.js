import { Router } from 'express'
import { asyncHandler, badRequest, forbidden, HttpError } from '../lib/errors.js'
import { dateOr, escapeAngles, int, iso, num, str, strOrNull } from '../lib/format.js'
import { mapIntervention, INTERVENTION_STATUSES, INTERVENTION_TYPES } from './interventions.js'
import { INVENTORY_TEMPLATE_CSV, mapItem, runInventoryImport } from './inventory.js'
import { newId } from '../db.js'

// Endpoint mantenuti per compatibilità con l'interfaccia attuale.
export const legacyRoutes = ({ db, auth, config, backup }) => {
  const router = Router()

  router.get('/bootstrap', asyncHandler(async (req, res) => {
    const [customers, tickets, interventions, inventory] = await Promise.all([
      db.query('SELECT * FROM "customers" ORDER BY "createdAt"'),
      db.query('SELECT * FROM "tickets" ORDER BY "createdAt"'),
      db.query('SELECT * FROM "interventions" ORDER BY "openedAt"'),
      db.query('SELECT * FROM "inventory" ORDER BY "createdAt"'),
    ])
    res.json({
      customers,
      tickets: tickets.map((t) => ({ ...t, subject: escapeAngles(t.subject), description: escapeAngles(t.description || '') })),
      interventions: interventions.map((row) => mapIntervention(row)),
      sparePartsOrders: [],
      quotes: [],
      inventory: inventory.map(mapItem),
      settings: [],
    })
  }))

  // Il vecchio protocollo di sync scriveva sul database SQLite temporaneo: non più supportato.
  router.post('/sync', (req, res) => res.status(410).json({ error: 'Sincronizzazione legacy non più supportata: i dati sono salvati direttamente sul server.', code: 'sync_removed' }))

  // Ordini ricambi e preventivi sono gestiti come interventi (tipo ordine_ricambi / preventivo).
  for (const path of ['/spare-parts-orders', '/quotes']) {
    router.get(path, (req, res) => res.json([]))
    router.all([path, `${path}/:id`], (req, res) => res.status(410).json({ error: 'Usa gli interventi di tipo ordine_ricambi / preventivo.', code: 'endpoint_removed' }))
  }

  router.get('/import/template', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="template_magazzino.csv"')
    res.send(INVENTORY_TEMPLATE_CSV)
  })

  // Upload multipart (campo "file") di un CSV: viene importato nel magazzino sommando le quantità.
  router.post('/import/excel', auth.requireRole('ADMIN'), asyncHandler(async (req, res) => {
    const contentType = String(req.headers['content-type'] || '')
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    if (!boundary) throw badRequest('File mancante.')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf-8')
    const part = body.split(`--${boundary[1] || boundary[2]}`).find((section) => /name="file"/.test(section))
    if (!part) throw badRequest('File mancante.')
    if (/filename="[^"]*\.xlsx"/i.test(part)) throw badRequest('Formato XLSX non supportato: esporta il foglio in CSV.')
    const csv = part.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n$/, '')
    const report = await runInventoryImport(db, { csv, mode: 'add' }, req.user.id)
    res.json(report)
  }))

  // Ripristino completo da backup: SOSTITUISCE tutti i dati di lavoro (gli utenti restano).
  // Disabilitato di default (ENABLE_DESTRUCTIVE_OPERATIONS) e preceduto da un backup automatico.
  router.post('/import', auth.requireRole('ADMIN'), asyncHandler(async (req, res) => {
    if (!config.ENABLE_DESTRUCTIVE_OPERATIONS) throw forbidden('Operazione disabilitata')
    const payload = req.body || {}
    if (str(payload.confirm) !== 'RESET_ALL_DATA') throw badRequest('Conferma import non valida.')
    const list = (name) => (Array.isArray(payload[name]) ? payload[name] : [])

    const pre = await backup.perform({ triggeredBy: 'pre-import-auto' })
    if (!pre.ok) throw new HttpError(503, 'Backup preventivo non riuscito: ripristino annullato.', 'pre_import_backup_failed')

    await db.tx(async (client) => {
      for (const table of ['inventory_movements', 'intervento_logs', 'notes', 'calendar_items', 'tickets', 'interventions', 'inventory', 'customers']) {
        await client.query(`DELETE FROM "${table}"`)
      }
      for (const c of list('customers')) {
        if (!str(c?.name)) continue
        await client.query(
          'INSERT INTO "customers" ("id", "name", "email", "phone", "address", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, NOW())',
          [str(c.id) || newId(), str(c.name), strOrNull(c.email), strOrNull(c.phone), strOrNull(c.address), dateOr(c.createdAt)],
        )
      }
      for (const t of list('tickets')) {
        if (!str(t?.subject)) continue
        await client.query(
          `INSERT INTO "tickets" ("id", "subject", "description", "status", "date", "time", "customerId", "version", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, (SELECT "id" FROM "customers" WHERE "id" = $7), $8, $9, NOW())`,
          [str(t.id) || newId(), str(t.subject), strOrNull(t.description), str(t.status, 'aperto'), strOrNull(t.date), strOrNull(t.time), str(t.customerId || t.customer_id), int(t.version, 1), dateOr(t.createdAt)],
        )
      }
      for (const i of list('interventions')) {
        const customerId = str(i?.clientId || i?.customerId)
        if (!customerId || !INTERVENTION_TYPES.includes(i.type)) continue
        await client.query(
          `INSERT INTO "interventions" ("id", "code", "customerId", "type", "status", "priority", "description", "openedAt", "closedAt", "additionalData", "version", "createdAt", "updatedAt")
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW() WHERE EXISTS (SELECT 1 FROM "customers" WHERE "id" = $3)`,
          [str(i.id) || newId(), str(i.code) || `INV-RESTORE-${newId().slice(0, 8)}`, customerId, i.type,
            INTERVENTION_STATUSES.includes(i.status) ? i.status : 'pendente', [1, 2, 3].includes(int(i.urgency ?? i.priority)) ? int(i.urgency ?? i.priority) : 2,
            strOrNull(i.description), dateOr(i.openedAt), iso(i.closedAt) ? new Date(i.closedAt) : null,
            typeof i.additionalData === 'object' && i.additionalData ? i.additionalData : {}, int(i.version, 1), dateOr(i.createdAt)],
        )
      }
      for (const it of list('inventory')) {
        if (!str(it?.name)) continue
        const id = str(it.id) || newId()
        await client.query(
          `INSERT INTO "inventory" ("id", "code", "name", "alt_codes", "location", "qty", "price", "minQty", "priceDate", "version", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
          [id, str(it.code) || id, str(it.name), strOrNull(it.alternateCodes ?? it.alt_codes), strOrNull(it.location), int(it.qty), num(it.price), int(it.minQty ?? it.min_qty), strOrNull(it.priceDate), int(it.version, 1), dateOr(it.createdAt)],
        )
      }
    })
    res.json({ status: 'ok', preImportBackup: pre.fileName })
  }))

  return router
}
