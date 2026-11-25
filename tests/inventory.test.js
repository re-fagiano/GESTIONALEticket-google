import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from './helpers.js'

describe('magazzino', () => {
  let t
  let admin
  before(async () => {
    t = await startTestApp()
    admin = await t.loggedIn('ADMIN')
  })
  after(async () => { await t.stop() })

  test('crea, cerca per codice/codici alternativi/parole e rifiuta codici duplicati', async () => {
    const created = await admin.post('/api/inventory', { code: 'BSH-00145', name: 'Pompa scarico lavastoviglie Bosch', location: 'A-01', qty: 4, price: '32,50', minQty: 2, alternateCodes: '00611332 SIEMENS-145' })
    assert.equal(created.status, 201)
    assert.equal(created.data.price, 32.5)
    assert.equal(created.data.alternateCodes, '00611332 SIEMENS-145')

    await admin.post('/api/inventory', { code: 'WHI-778', name: 'Resistenza lavatrice Whirlpool 2000W', location: 'B-02', qty: 1, minQty: 2 })

    const byCode = await admin.get('/api/inventory?q=bsh-00145')
    assert.deepEqual(byCode.data.map((i) => i.code), ['BSH-00145'])
    const byAlt = await admin.get('/api/inventory?q=00611332')
    assert.equal(byAlt.data[0].code, 'BSH-00145')
    const byWords = await admin.get('/api/inventory?q=resistenza%20whirlpool')
    assert.equal(byWords.data[0].code, 'WHI-778')
    const low = await admin.get('/api/inventory?stock=low')
    assert.deepEqual(low.data.map((i) => i.code), ['WHI-778'])

    const dup = await admin.post('/api/inventory', { code: 'bsh-00145', name: 'Doppione' })
    assert.equal(dup.status, 409)
    assert.equal(dup.data.code, 'code_exists')
  })

  test('carico/scarico atomico con storico e blocco giacenza negativa', async () => {
    const item = (await admin.post('/api/inventory', { code: 'MOV-1', name: 'Guarnizione oblò', qty: 2 })).data
    const scarico = await admin.post(`/api/inventory/${item.id}/movements`, { delta: -2, reason: 'scarico', note: 'Montata su riparazione' })
    assert.equal(scarico.status, 201)
    assert.equal(scarico.data.qty, 0)
    const troppo = await admin.post(`/api/inventory/${item.id}/movements`, { delta: -1 })
    assert.equal(troppo.status, 409)
    assert.equal(troppo.data.code, 'insufficient_stock')
    await admin.post(`/api/inventory/${item.id}/movements`, { delta: 5, reason: 'carico' })
    const detail = await admin.get(`/api/inventory/${item.id}`)
    assert.equal(detail.data.qty, 5)
    assert.deepEqual(detail.data.movements.map((m) => [m.delta, m.qtyAfter, m.reason]), [[5, 5, 'carico'], [-2, 0, 'scarico'], [2, 2, 'carico']])

    // 10 scarichi in parallelo da 1 pezzo su 5 disponibili: esattamente 5 riescono.
    const results = await Promise.all(Array.from({ length: 10 }, () => admin.post(`/api/inventory/${item.id}/movements`, { delta: -1 })))
    assert.equal(results.filter((r) => r.status === 201).length, 5)
    assert.equal((await admin.get(`/api/inventory/${item.id}`)).data.qty, 0)
  })

  test('modifica con controllo di versione e movimento di rettifica', async () => {
    const item = (await admin.post('/api/inventory', { code: 'VER-1', name: 'Termostato', qty: 3, price: 10 })).data
    const ok = await admin.put(`/api/inventory/${item.id}`, { ...item, qty: 7, price: 12 })
    assert.equal(ok.status, 200)
    assert.equal(ok.data.qty, 7)
    assert.equal(ok.data.priceDate, new Date().toISOString().slice(0, 10))
    const stale = await admin.put(`/api/inventory/${item.id}`, { ...item, name: 'Vecchia versione' })
    assert.equal(stale.status, 409)
    assert.equal(stale.data.code, 'conflict')
    assert.equal(stale.data.current.qty, 7)
    const detail = await admin.get(`/api/inventory/${item.id}`)
    assert.equal(detail.data.movements[0].reason, 'rettifica')
    assert.equal(detail.data.movements[0].delta, 4)
  })

  test('import CSV con intestazioni del negozio: somma, sostituisce, anteprima e righe scartate', async () => {
    const csv = '\uFEFFPOSIZIONE;CODICE;DESCRIZIONE;PREZZO AL PUBBLICO;QUANTITA\nC-01;IMP-1;Cerniera porta frigo;8,90;3\nC-02;IMP-2;Filtro anticalcare;5;10\n;;;;\nC-03;;Senza codice;1;1\nC-01;IMP-1;Cerniera porta frigo;8,90;2\n'
    const preview = await admin.post('/api/inventory/import', { csv, mode: 'add', dryRun: true })
    assert.equal(preview.status, 200)
    assert.equal(preview.data.created, 2)
    assert.equal((await admin.get('/api/inventory?q=IMP-1')).data.length, 0, "l'anteprima non salva nulla")

    const first = await admin.post('/api/inventory/import', { csv, mode: 'add' })
    assert.equal(first.data.created, 2)
    assert.deepEqual(first.data.skipped, [{ line: 5, reason: 'Codice mancante' }])
    assert.equal((await admin.get('/api/inventory?q=IMP-1')).data[0].qty, 5, 'righe con lo stesso codice si sommano')

    const again = await admin.post('/api/inventory/import', { rows: [{ CODICE: 'imp-2', QUANTITA: '4' }], mode: 'add' })
    assert.equal(again.data.updated, 1)
    assert.equal((await admin.get('/api/inventory?q=IMP-2')).data[0].qty, 14)

    const inventario = await admin.post('/api/inventory/import', { rows: [{ codice: 'IMP-2', quantita: '6' }], mode: 'set' })
    assert.equal(inventario.data.items[0].qtyBefore, 14)
    assert.equal((await admin.get('/api/inventory?q=IMP-2')).data[0].qty, 6)
  })

  test('riepilogo, export CSV e template', async () => {
    const summary = await admin.get('/api/inventory/summary')
    assert.equal(summary.status, 200)
    assert.ok(summary.data.items >= 5)
    assert.ok(summary.data.lowStock >= 1)
    const raw = await admin.get('/api/inventory/export.csv', { raw: true })
    const bytes = new Uint8Array(await raw.arrayBuffer())
    assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM UTF-8 per Excel')
    const csv = new TextDecoder().decode(bytes)
    assert.match(csv, /^POSIZIONE;CODICE;DESCRIZIONE;PREZZO AL PUBBLICO;QUANTITA/)
    assert.match(csv, /A-01;BSH-00145;Pompa scarico lavastoviglie Bosch;32,5;4;2;00611332 SIEMENS-145/)
    const template = await admin.get('/api/import/template')
    assert.match(template.data, /POSIZIONE;CODICE;DESCRIZIONE/)
  })

  test("l'export viene re-importato identico (giro completo)", async () => {
    const csv = (await admin.get('/api/inventory/export.csv')).data
    const report = await admin.post('/api/inventory/import', { csv, mode: 'set' })
    assert.equal(report.data.created, 0)
    assert.equal(report.data.updated, 0)
    assert.ok(report.data.unchanged >= 5)
  })

  test('vecchio upload multipart /api/import/excel salva su Postgres', async () => {
    const form = new FormData()
    form.append('file', new Blob(['CODICE;DESCRIZIONE;QUANTITA\nXL-1;Motore ventola;2\n']), 'magazzino.csv')
    const cookie = [...admin.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(`${t.baseUrl}/api/import/excel`, { method: 'POST', body: form, headers: { cookie, 'x-csrf-token': decodeURIComponent(admin.jar.get('csrf_token')) } })
    assert.equal(res.status, 200)
    assert.equal((await admin.get('/api/inventory?q=XL-1')).data[0].qty, 2)
  })
})
