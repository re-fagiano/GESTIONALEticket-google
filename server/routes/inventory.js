import { Router } from 'express'
import { asyncHandler, badRequest, conflict, HttpError, notFound } from '../lib/errors.js'
import { escapeLike, int, iso, listParams, num, parseCsv, searchTerms, str, strOrNull, toCsv } from '../lib/format.js'
import { newId } from '../db.js'

const SORT = {
  createdAt: '"createdAt"', created_at: '"createdAt"', updatedAt: '"updatedAt"', updated_at: '"updatedAt"',
  name: 'lower("name")', code: 'lower(coalesce("code","id"))', location: 'lower(coalesce("location",\'\'))',
  qty: '"qty"', price: '"price"', minQty: '"minQty"', min_qty: '"minQty"',
}

export const MOVEMENT_REASONS = ['carico', 'scarico', 'rettifica', 'reso', 'import', 'intervento', 'inventario']

// Formato di risposta compatibile con l'interfaccia attuale (alternateCodes al posto di alt_codes).
export const mapItem = (row) => (row ? {
  id: row.id,
  code: row.code || row.id,
  name: row.name,
  alternateCodes: row.alt_codes || '',
  location: row.location || '',
  qty: row.qty,
  price: Number(row.price) || 0,
  minQty: row.minQty,
  priceDate: row.priceDate || '',
  lowStock: row.minQty > 0 && row.qty <= row.minQty,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: row.version,
} : null)

const mapMovement = (row) => ({
  id: row.id,
  itemId: row.itemId,
  delta: row.delta,
  qtyAfter: row.qtyAfter,
  reason: row.reason,
  note: row.note || '',
  interventionId: row.interventionId || null,
  userId: row.userId || null,
  userEmail: row.userEmail || null,
  itemName: row.itemName,
  itemCode: row.itemCode,
  ...(row.itemPrice !== undefined ? { itemPrice: Number(row.itemPrice) || 0 } : {}),
  createdAt: iso(row.createdAt),
})

// Accetta sia i campi dell'API (code, name, qty...) sia le intestazioni del file Excel del negozio
// (POSIZIONE, CODICE, DESCRIZIONE, PREZZO AL PUBBLICO, QUANTITA) e le vecchie intestazioni del template.
const ALIASES = {
  code: ['code', 'codice', 'cod', 'sku', 'id'],
  name: ['name', 'nome', 'descrizione', 'descrizione articolo', 'descrizione prodotto', 'articolo', 'prodotto'],
  location: ['location', 'posizione', 'pos', 'locazione', 'ubicazione', 'scaffale'],
  price: ['price', 'prezzo', 'prezzo al pubblico', 'prezzo pubblico', 'prezzo vendita'],
  qty: ['qty', 'quantita', 'quantità', 'qta', 'quantity', 'giacenza'],
  minQty: ['minqty', 'min_qty', 'soglia', 'scorta minima', 'minimo'],
  alternateCodes: ['alternatecodes', 'alt_codes', 'codici alternativi', 'codici alt', 'altcodes'],
}
const pickAlias = (row, field) => {
  const lower = Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [String(k).trim().toLowerCase(), v]))
  for (const alias of ALIASES[field]) if (lower[alias] !== undefined && String(lower[alias]).trim() !== '') return lower[alias]
  return undefined
}

export const itemFields = (body, current = {}) => {
  const name = str(body?.name ?? current.name)
  if (!name) throw badRequest('Nome ricambio obbligatorio.')
  const qty = int(body?.qty, current.qty ?? 0)
  const minQty = int(body?.minQty, current.minQty ?? 0)
  const price = num(body?.price, current.price ?? 0)
  if (minQty < 0) throw badRequest('La scorta minima non può essere negativa.')
  if (price < 0) throw badRequest('Il prezzo non può essere negativo.')
  return {
    code: str(body?.code ?? current.code),
    name,
    altCodes: body?.alternateCodes !== undefined || body?.altCodes !== undefined
      ? strOrNull(body?.alternateCodes ?? body?.altCodes)
      : (current.alt_codes ?? null),
    location: body?.location !== undefined ? strOrNull(body.location) : (current.location ?? null),
    qty,
    price,
    minQty,
    priceDate: body?.priceDate !== undefined ? strOrNull(body.priceDate) : (current.priceDate ?? null),
  }
}

export const inventoryRoutes = ({ db, auth }) => {
  const router = Router()
  const writer = auth.requireRole('ADMIN', 'OPERATOR')

  const findByCode = (client, code, excludeId = null) => client.one(
    'SELECT * FROM "inventory" WHERE lower(coalesce("code","id")) = lower($1) AND ($2::text IS NULL OR "id" <> $2) LIMIT 1',
    [code, excludeId],
  )

  const recordMovement = (client, { itemId, delta, qtyAfter, reason, note, interventionId, userId }) => client.query(
    `INSERT INTO "inventory_movements" ("id", "itemId", "delta", "qtyAfter", "reason", "note", "interventionId", "userId", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [newId(), itemId, delta, qtyAfter, reason, note || null, interventionId || null, userId || null],
  )

  const buildFilter = (query) => {
    const params = []
    const where = []
    for (const term of searchTerms(query.q)) {
      params.push(`%${escapeLike(term)}%`)
      const p = `$${params.length}`
      where.push(`(lower(coalesce("code","id")) LIKE ${p} OR lower("name") LIKE ${p} OR lower(coalesce("alt_codes",'')) LIKE ${p} OR lower(coalesce("location",'')) LIKE ${p})`)
    }
    const stock = str(query.stock || (str(query.lowStock) === '1' ? 'low' : ''))
    if (stock === 'low') where.push('("minQty" > 0 AND "qty" <= "minQty")')
    if (stock === 'out') where.push('"qty" <= 0')
    if (stock === 'available') where.push('"qty" > 0')
    const location = str(query.location)
    if (location) { params.push(location.toLowerCase()); where.push(`lower(coalesce("location",'')) = $${params.length}`) }
    const locationPrefix = str(query.locationPrefix)
    if (locationPrefix) { params.push(`${escapeLike(locationPrefix.toLowerCase())}%`); where.push(`lower(coalesce("location",'')) LIKE $${params.length}`) }
    return { params, where: where.length ? `WHERE ${where.join(' AND ')}` : '' }
  }

  router.get('/', asyncHandler(async (req, res) => {
    const { sortColumn, order, skip, take } = listParams(req.query, { allowedSort: SORT, defaultSort: 'createdAt', maxTake: 500 })
    const { params, where } = buildFilter(req.query)
    params.push(take, skip)
    const rows = await db.query(
      `SELECT * FROM "inventory" ${where} ORDER BY ${sortColumn} ${order}, "id" LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    if (str(req.query.withTotal) === '1') {
      const { params: countParams, where: countWhere } = buildFilter(req.query)
      const total = await db.one(`SELECT COUNT(*)::int AS n FROM "inventory" ${countWhere}`, countParams)
      res.setHeader('X-Total-Count', String(total?.n ?? 0))
    }
    res.json(rows.map(mapItem))
  }))

  router.get('/summary', asyncHandler(async (req, res) => {
    const totals = await db.one(`
      SELECT COUNT(*)::int AS "items",
             COALESCE(SUM(GREATEST("qty",0)),0)::int AS "pieces",
             COALESCE(SUM(GREATEST("qty",0) * "price"),0)::float AS "value",
             COUNT(*) FILTER (WHERE "minQty" > 0 AND "qty" <= "minQty")::int AS "lowStock",
             COUNT(*) FILTER (WHERE "qty" <= 0)::int AS "outOfStock"
      FROM "inventory"`)
    const locations = await db.query(`
      SELECT coalesce(nullif("location",''), '—') AS "location", COUNT(*)::int AS "items"
      FROM "inventory" GROUP BY 1 ORDER BY 1 LIMIT 500`)
    const movementsToday = await db.one(`SELECT COUNT(*)::int AS n FROM "inventory_movements" WHERE "createdAt" >= date_trunc('day', NOW())`)
    res.json({ ...totals, value: Math.round((totals?.value || 0) * 100) / 100, locations, movementsToday: movementsToday?.n || 0 })
  }))

  router.get('/movements', asyncHandler(async (req, res) => {
    const take = Math.min(500, Math.max(1, int(req.query.take, 50)))
    const params = [take]
    const filters = []
    if (str(req.query.interventionId)) { params.push(str(req.query.interventionId)); filters.push(`m."interventionId" = $${params.length}`) }
    const rows = await db.query(
      `SELECT m.*, i."name" AS "itemName", coalesce(i."code", i."id") AS "itemCode", i."price" AS "itemPrice", u."email" AS "userEmail"
       FROM "inventory_movements" m JOIN "inventory" i ON i."id" = m."itemId" LEFT JOIN "users" u ON u."id" = m."userId"
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY m."createdAt" DESC LIMIT $1`,
      params,
    )
    res.json(rows.map(mapMovement))
  }))

  router.get('/export.csv', asyncHandler(async (req, res) => {
    const { params, where } = buildFilter(req.query)
    const rows = await db.query(`SELECT * FROM "inventory" ${where} ORDER BY lower(coalesce("location",'')), lower("name")`, params)
    const csv = toCsv([
      { label: 'POSIZIONE', get: (r) => r.location || '' },
      { label: 'CODICE', get: (r) => r.code || r.id },
      { label: 'DESCRIZIONE', key: 'name' },
      { label: 'PREZZO AL PUBBLICO', get: (r) => String(Number(r.price) || 0).replace('.', ',') },
      { label: 'QUANTITA', key: 'qty' },
      { label: 'SCORTA MINIMA', key: 'minQty' },
      { label: 'CODICI ALTERNATIVI', get: (r) => r.alt_codes || '' },
    ], rows)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="magazzino-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(csv)
  }))

  router.get('/:id', asyncHandler(async (req, res) => {
    const row = await db.one('SELECT * FROM "inventory" WHERE "id" = $1', [req.params.id])
    if (!row) throw notFound('Ricambio non trovato.')
    const movements = await db.query(
      `SELECT m.*, u."email" AS "userEmail" FROM "inventory_movements" m LEFT JOIN "users" u ON u."id" = m."userId"
       WHERE m."itemId" = $1 ORDER BY m."createdAt" DESC LIMIT 100`,
      [req.params.id],
    )
    res.json({ ...mapItem(row), movements: movements.map(mapMovement) })
  }))

  router.post('/', writer, asyncHandler(async (req, res) => {
    const fields = itemFields(req.body)
    const id = str(req.body?.id) || newId()
    const created = await db.tx(async (client) => {
      const existingId = await client.one('SELECT * FROM "inventory" WHERE "id" = $1', [id])
      if (existingId) return existingId // retry dello stesso inserimento
      const code = fields.code || id
      const duplicate = await findByCode(client, code)
      if (duplicate && !req.body?.allowDuplicateCode) {
        throw new HttpError(409, `Esiste già un ricambio con codice ${code}.`, 'code_exists', { current: mapItem(duplicate) })
      }
      const row = await client.one(
        `INSERT INTO "inventory" ("id", "code", "name", "alt_codes", "location", "qty", "price", "minQty", "priceDate", "version", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW(), NOW()) RETURNING *`,
        [id, code, fields.name, fields.altCodes, fields.location, fields.qty, fields.price, fields.minQty, fields.priceDate],
      )
      if (fields.qty !== 0) await recordMovement(client, { itemId: id, delta: fields.qty, qtyAfter: fields.qty, reason: 'carico', note: 'Carico iniziale', userId: req.user.id })
      return row
    })
    res.status(201).json(mapItem(created))
  }))

  router.put('/:id', writer, asyncHandler(async (req, res) => {
    const updated = await db.tx(async (client) => {
      const current = await client.one('SELECT * FROM "inventory" WHERE "id" = $1 FOR UPDATE', [req.params.id])
      if (!current) throw notFound('Ricambio non trovato.')
      // Controllo di concorrenza: se un altro operatore ha modificato il ricambio nel frattempo, avvisiamo.
      if (req.body?.version !== undefined && int(req.body.version, current.version) !== current.version) {
        throw conflict('Conflitto magazzino: il ricambio è stato modificato da un altro operatore. Aggiorna i dati.', mapItem(current))
      }
      const fields = itemFields(req.body, current)
      const code = fields.code || current.code || current.id
      const duplicate = await findByCode(client, code, current.id)
      if (duplicate && !req.body?.allowDuplicateCode) throw new HttpError(409, `Esiste già un ricambio con codice ${code}.`, 'code_exists', { current: mapItem(duplicate) })
      const row = await client.one(
        `UPDATE "inventory" SET "code" = $2, "name" = $3, "alt_codes" = $4, "location" = $5, "qty" = $6, "price" = $7, "minQty" = $8,
           "priceDate" = $9, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = $1 RETURNING *`,
        [current.id, code, fields.name, fields.altCodes, fields.location, fields.qty, fields.price, fields.minQty,
          // Se il prezzo cambia e la data prezzo non è stata cambiata a mano, la aggiorniamo a oggi.
          fields.price !== Number(current.price) && (fields.priceDate || null) === (current.priceDate || null)
            ? new Date().toISOString().slice(0, 10) : fields.priceDate],
      )
      if (fields.qty !== current.qty) {
        await recordMovement(client, { itemId: current.id, delta: fields.qty - current.qty, qtyAfter: fields.qty, reason: 'rettifica', note: str(req.body?.movementNote) || 'Modifica scheda', userId: req.user.id })
      }
      return row
    })
    res.json(mapItem(updated))
  }))

  // Carico / scarico atomico: evita di sovrascrivere quantità modificate in contemporanea da un altro operatore.
  router.post('/:id/movements', writer, asyncHandler(async (req, res) => {
    const delta = int(req.body?.delta, 0)
    if (!delta) throw badRequest('Indica una quantità diversa da zero.')
    const reason = str(req.body?.reason, delta > 0 ? 'carico' : 'scarico')
    if (!MOVEMENT_REASONS.includes(reason)) throw badRequest('Causale non valida.')
    const result = await db.tx(async (client) => {
      const current = await client.one('SELECT * FROM "inventory" WHERE "id" = $1 FOR UPDATE', [req.params.id])
      if (!current) throw notFound('Ricambio non trovato.')
      const next = current.qty + delta
      if (next < 0 && !req.body?.allowNegative) {
        throw new HttpError(409, `Giacenza insufficiente: disponibili ${current.qty}, richiesti ${Math.abs(delta)}.`, 'insufficient_stock', { current: mapItem(current) })
      }
      const interventionId = str(req.body?.interventionId)
      if (interventionId && !(await client.one('SELECT 1 FROM "interventions" WHERE "id" = $1', [interventionId]))) throw badRequest('Intervento non trovato.')
      const row = await client.one('UPDATE "inventory" SET "qty" = $2, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = $1 RETURNING *', [current.id, next])
      await recordMovement(client, { itemId: current.id, delta, qtyAfter: next, reason, note: str(req.body?.note), interventionId, userId: req.user.id })
      return row
    })
    res.status(201).json(mapItem(result))
  }))

  router.delete('/:id', writer, asyncHandler(async (req, res) => {
    await db.query('DELETE FROM "inventory" WHERE "id" = $1', [req.params.id])
    res.status(204).end()
  }))

  return router
}

// Import massivo: { rows: [...] } oppure { csv: "testo del file" }.
// mode "add" somma le quantità (arrivo merce), "set" le sostituisce (inventario fisico).
export const runInventoryImport = async (db, body, userId) => {
  const req = { body, user: { id: userId } }
  const mode = str(req.body?.mode, 'add')
  if (!['add', 'set'].includes(mode)) throw badRequest('Modalità import non valida (add | set).')
  const dryRun = Boolean(req.body?.dryRun)
  const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : parseCsv(req.body?.csv)
  if (!rawRows.length) throw badRequest('File vuoto o non valido.')
  if (rawRows.length > 20000) throw badRequest('Troppe righe (massimo 20.000 per import).')

  const report = { mode, dryRun, total: rawRows.length, created: 0, updated: 0, unchanged: 0, skipped: [], items: [] }

  await db.tx(async (client) => {
    const seen = new Map()
    for (let index = 0; index < rawRows.length; index += 1) {
      const raw = rawRows[index]
      const line = raw?.__line || index + 2 // riga del foglio, contando l'intestazione
      const code = str(pickAlias(raw, 'code'))
      const name = str(pickAlias(raw, 'name'))
      if (!code && !name) continue // riga vuota
      if (!code) { report.skipped.push({ line, reason: 'Codice mancante' }); continue }
      const key = code.toLowerCase()
      const qtyRaw = pickAlias(raw, 'qty')
      const qty = int(qtyRaw, 0)
      const priceRaw = pickAlias(raw, 'price')
      const price = priceRaw === undefined ? undefined : num(priceRaw, NaN)
      if (price !== undefined && (!Number.isFinite(price) || price < 0)) { report.skipped.push({ line, code, reason: 'Prezzo non valido' }); continue }
      const minQtyRaw = pickAlias(raw, 'minQty')
      const location = pickAlias(raw, 'location')
      const altCodes = pickAlias(raw, 'alternateCodes')

      // Righe duplicate nello stesso file: le quantità vengono sommate.
      if (seen.has(key)) {
        const previous = seen.get(key)
        const row = await client.one(
          'UPDATE "inventory" SET "qty" = "qty" + $2, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = $1 RETURNING *',
          [previous.id, qty],
        )
        if (qty) await client.query(
          `INSERT INTO "inventory_movements" ("id", "itemId", "delta", "qtyAfter", "reason", "note", "userId", "createdAt") VALUES ($1, $2, $3, $4, 'import', $5, $6, NOW())`,
          [newId(), row.id, qty, row.qty, `Import riga ${line} (codice ripetuto)`, req.user.id],
        )
        continue
      }

      const existing = await client.one('SELECT * FROM "inventory" WHERE lower(coalesce("code","id")) = $1 ORDER BY "createdAt" LIMIT 1 FOR UPDATE', [key])
      if (!existing) {
        if (!name) { report.skipped.push({ line, code, reason: 'Descrizione mancante per un nuovo articolo' }); continue }
        const row = await client.one(
          `INSERT INTO "inventory" ("id", "code", "name", "alt_codes", "location", "qty", "price", "minQty", "priceDate", "version", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW(), NOW()) RETURNING *`,
          [newId(), code, name, strOrNull(altCodes), strOrNull(location), qty, price ?? 0, int(minQtyRaw, 0), price !== undefined ? new Date().toISOString().slice(0, 10) : null],
        )
        if (qty) await client.query(
          `INSERT INTO "inventory_movements" ("id", "itemId", "delta", "qtyAfter", "reason", "note", "userId", "createdAt") VALUES ($1, $2, $3, $4, 'import', $5, $6, NOW())`,
          [newId(), row.id, qty, qty, `Import riga ${line} (nuovo articolo)`, req.user.id],
        )
        seen.set(key, row)
        report.created += 1
        report.items.push({ line, code, action: 'created', qtyBefore: 0, qtyAfter: qty })
        continue
      }

      const nextQty = qtyRaw === undefined ? existing.qty : (mode === 'add' ? existing.qty + qty : qty)
      const next = {
        name: name || existing.name,
        location: location !== undefined ? strOrNull(location) : existing.location,
        altCodes: altCodes !== undefined ? strOrNull(altCodes) : existing.alt_codes,
        price: price ?? Number(existing.price),
        minQty: minQtyRaw !== undefined ? int(minQtyRaw, existing.minQty) : existing.minQty,
      }
      const changed = nextQty !== existing.qty || next.name !== existing.name || next.location !== existing.location
        || next.altCodes !== existing.alt_codes || next.price !== Number(existing.price) || next.minQty !== existing.minQty
      if (!changed) { seen.set(key, existing); report.unchanged += 1; continue }
      const row = await client.one(
        `UPDATE "inventory" SET "name" = $2, "location" = $3, "alt_codes" = $4, "price" = $5, "minQty" = $6, "qty" = $7,
           "priceDate" = CASE WHEN $5 <> "price" THEN $8 ELSE "priceDate" END, "version" = "version" + 1, "updatedAt" = NOW()
         WHERE "id" = $1 RETURNING *`,
        [existing.id, next.name, next.location, next.altCodes, next.price, next.minQty, nextQty, new Date().toISOString().slice(0, 10)],
      )
      if (nextQty !== existing.qty) await client.query(
        `INSERT INTO "inventory_movements" ("id", "itemId", "delta", "qtyAfter", "reason", "note", "userId", "createdAt") VALUES ($1, $2, $3, $4, 'import', $5, $6, NOW())`,
        [newId(), row.id, nextQty - existing.qty, nextQty, `Import riga ${line} (${mode === 'add' ? 'carico' : 'inventario'})`, req.user.id],
      )
      seen.set(key, row)
      report.updated += 1
      report.items.push({ line, code, action: 'updated', qtyBefore: existing.qty, qtyAfter: nextQty })
    }
    // Anteprima: calcoliamo tutto dentro la transazione e poi annulliamo.
    if (dryRun) throw Object.assign(new Error('dry_run'), { dryRunReport: true })
  }).catch((error) => {
    if (!error?.dryRunReport) throw error
  })

  report.items = report.items.slice(0, 1000)
  return report
}

export const inventoryImportRoute = ({ db }) => asyncHandler(async (req, res) => {
  res.json(await runInventoryImport(db, req.body, req.user.id))
})

export const INVENTORY_TEMPLATE_CSV = '\uFEFFPOSIZIONE;CODICE;DESCRIZIONE;PREZZO AL PUBBLICO;QUANTITA;SCORTA MINIMA\r\nAF-01-A;SKU123;Guarnizione pompa;12,50;3;1\r\n'
