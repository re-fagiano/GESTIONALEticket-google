import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from './helpers.js'

describe('clienti, ticket, interventi, calendario, backup', () => {
  let t
  let admin
  let customer
  before(async () => {
    t = await startTestApp()
    admin = await t.loggedIn('ADMIN')
    customer = (await admin.post('/api/customers', { name: 'Rossi Maria', phone: '333 1234567', address: 'Via Roma 1, Pesaro' })).data
  })
  after(async () => { await t.stop() })

  test('clienti: ricerca per più parole e blocco eliminazione con interventi', async () => {
    const found = await admin.get('/api/customers?q=rossi%20pesaro')
    assert.equal(found.data[0].id, customer.id)
    await admin.post('/api/interventions', { clientId: customer.id, type: 'chiamata', description: 'Lavatrice non scarica' })
    const del = await admin.del(`/api/customers/${customer.id}`)
    assert.equal(del.status, 409)
  })

  test('i ticket ora restano su Postgres e PUT recupera ticket rimasti solo nel browser', async () => {
    const created = await admin.post('/api/tickets', { subject: 'Frigo rumoroso', customerId: customer.id })
    assert.equal(created.status, 201)
    const row = await t.db.one('SELECT * FROM "tickets" WHERE "id" = $1', [created.data.id])
    assert.equal(row.subject, 'Frigo rumoroso')
    const orphan = await admin.put('/api/tickets/ticket-solo-nel-browser', { subject: 'Forno', customerId: 'cliente-inesistente' })
    assert.equal(orphan.status, 200)
    assert.equal(orphan.data.customerId, null)
  })

  test('intervento: creazione, cambio stato con data chiusura, storico, conversione chiamata→riparazione', async () => {
    const call = (await admin.post('/api/interventions', { clientId: customer.id, type: 'chiamata', urgency: 3, description: 'Forno non scalda' })).data
    assert.match(call.code, /^INV-\d{8}-\d{6}$/)
    assert.equal(call.logs[0].action, 'intervento_creato')

    const working = await admin.patch(`/api/interventions/${call.id}`, { status: 'in_lavorazione' })
    assert.equal(working.data.status, 'in_lavorazione')
    assert.equal(working.data.closedAt, null)

    const repair = await admin.post(`/api/riparazioni/from-chiamata/${call.id}`)
    assert.equal(repair.status, 201)
    assert.equal(repair.data.type, 'riparazione')
    const closedCall = await admin.get(`/api/interventions/${call.id}`)
    assert.equal(closedCall.data.status, 'completato')
    assert.ok(closedCall.data.closedAt)

    const reopened = await admin.patch(`/api/interventi/${call.id}`, { status: 'pendente' })
    assert.equal(reopened.data.closedAt, null)

    const list = await admin.get('/api/riparazioni')
    assert.ok(list.data.some((i) => i.id === repair.data.id && i.customerName === 'Rossi Maria'))

    // retry dello stesso POST con lo stesso id: nessun duplicato
    const id = 'intervento-retry-1'
    await admin.post('/api/interventions', { id, clientId: customer.id, type: 'preventivo' })
    await admin.post('/api/interventions', { id, clientId: customer.id, type: 'preventivo' })
    assert.equal((await t.db.one('SELECT COUNT(*)::int AS n FROM "interventions" WHERE "id" = $1', [id])).n, 1)
  })

  test('scarico di magazzino collegato a un intervento', async () => {
    const repair = (await admin.post('/api/interventions', { clientId: customer.id, type: 'riparazione' })).data
    const item = (await admin.post('/api/inventory', { code: 'LINK-1', name: 'Pressostato', qty: 3 })).data
    await admin.post(`/api/inventory/${item.id}/movements`, { delta: -1, reason: 'intervento', interventionId: repair.id })
    const movements = await admin.get(`/api/inventory/movements?interventionId=${repair.id}`)
    assert.equal(movements.data.length, 1)
    assert.equal(movements.data[0].itemCode, 'LINK-1')
  })

  test('calendario: crea, sposta, elimina', async () => {
    const ev = await admin.post('/api/calendar', { title: 'Sopralluogo', startAt: '2026-12-01T09:00:00.000Z', endAt: '2026-12-01T10:00:00.000Z', customerId: customer.id })
    assert.equal(ev.status, 201)
    const moved = await admin.patch(`/api/calendar/${ev.data.id}`, { startAt: '2026-12-02T09:00:00.000Z', endAt: '2026-12-02T10:30:00.000Z' })
    assert.equal(new Date(moved.data.startAt).toISOString(), '2026-12-02T09:00:00.000Z')
    const range = await admin.get('/api/calendar?from=2026-12-02T00:00:00.000Z&to=2026-12-03T00:00:00.000Z')
    assert.equal(range.data.length, 1)
    assert.equal((await admin.del(`/api/calendar/${ev.data.id}`)).status, 204)
  })

  test('backup: senza Google è "not_configured" (non più "degraded") e l\'export JSON contiene tutte le tabelle', async () => {
    const res = await admin.post('/api/admin/backup')
    assert.equal(res.status, 200)
    assert.equal(res.data.result.mode, 'not_configured')
    assert.equal(res.data.lastRun.status, 'not_configured')
    const exported = await admin.get('/api/admin/export/json')
    for (const key of ['customers', 'tickets', 'interventions', 'interventionLogs', 'notes', 'calendarItems', 'inventory', 'inventoryMovements', 'users']) {
      assert.ok(Array.isArray(exported.data[key]), `manca ${key}`)
    }
    assert.ok(exported.data.inventoryMovements.length > 0)
    assert.ok(!('tokenHash' in (exported.data.users[0] || {})))
  })

  test('bootstrap compatibile con la vecchia interfaccia', async () => {
    const res = await admin.get('/api/bootstrap')
    assert.equal(res.status, 200)
    assert.ok(res.data.customers.length && res.data.interventions.length && res.data.inventory.length && res.data.tickets.length)
    assert.ok('alternateCodes' in res.data.inventory[0])
  })

  test('le date scritte dal database sono in UTC (nessuno spostamento di fuso)', async () => {
    const before = Date.now()
    const item = (await admin.post('/api/inventory', { code: 'TZ-1', name: 'Orario' })).data
    assert.ok(Math.abs(new Date(item.createdAt).getTime() - before) < 60_000, `createdAt fuori fuso: ${item.createdAt}`)
  })

  test('endpoint sconosciuti e JSON non valido', async () => {
    assert.equal((await admin.get('/api/non-esiste')).status, 404)
    const bad = await admin.post('/api/customers', '{rotto', { headers: { 'content-type': 'application/json' } })
    assert.equal(bad.status, 400)
  })
})
