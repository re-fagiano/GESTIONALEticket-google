import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import { startTestApp } from './helpers.js'

// PNG 1×1 nero: basta come "firma" per verificare l'inserimento nel PDF.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

describe('rapportino con firma e PDF', () => {
  let t
  let admin
  let operator
  let customer
  before(async () => {
    t = await startTestApp()
    admin = await t.loggedIn('ADMIN')
    operator = await t.loggedIn('OPERATOR')
    customer = (await admin.post('/api/customers', { name: 'Gallo Sofia', phone: '333 9998887', address: 'Via Branca 3, Pesaro' })).data
  })
  after(async () => { await t.stop() })

  test('dati del negozio: lettura per tutti, modifica solo admin', async () => {
    const defaults = await operator.get('/api/shop-profile')
    assert.equal(defaults.data.hourlyRate, 40)
    assert.equal((await operator.put('/api/shop-profile', { name: 'X' })).status, 403)
    const saved = await admin.put('/api/shop-profile', { name: 'Elettrodomestici Pesaro', vatNumber: '01234567890', hourlyRate: '45', callFee: 30 })
    assert.equal(saved.data.hourlyRate, 45)
    assert.equal((await operator.get('/api/shop-profile')).data.name, 'Elettrodomestici Pesaro')
  })

  test('crea rapportino firmato: totale calcolato dal server, PDF valido, intervento chiuso, numero progressivo stabile', async () => {
    const call = (await operator.post('/api/interventions', { clientId: customer.id, type: 'chiamata', description: 'Lavatrice perde acqua — guarnizione 😅' })).data
    const sig = await operator.post(`/api/files?name=firma.png&type=image/png&kind=signature&interventionId=${call.id}`, PNG, { headers: { 'content-type': 'image/png' } })
    assert.equal(sig.status, 201)

    const res = await operator.post(`/api/interventions/${call.id}/report`, {
      workDone: 'Sostituita guarnizione oblò, provato ciclo 40°. Nessuna perdita ✅',
      lines: [
        { kind: 'call', description: 'Diritto di chiamata', qty: 1, unitPrice: 30 },
        { kind: 'labor', description: 'Manodopera (ore)', qty: 1.5, unitPrice: 45 },
        { kind: 'part', description: 'Guarnizione oblò Whirlpool', qty: 1, unitPrice: 28.9 },
        { kind: 'other', description: '', qty: 1, unitPrice: 999 },
      ],
      discount: 5,
      paymentMethod: 'carta',
      signerName: 'Sofia Gallo',
      signatureFileId: sig.data.id,
      closeIntervention: true,
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    const { report, intervention } = res.data
    assert.match(report.number, /^R-\d{4}-0001$/)
    assert.equal(report.lines.length, 3, 'le righe senza descrizione vengono scartate')
    assert.equal(report.total, 30 + 67.5 + 28.9 - 5)
    assert.equal(intervention.status, 'completato')
    assert.ok(intervention.closedAt)
    assert.ok(intervention.logs.some((l) => l.action === 'rapportino_creato'))

    const pdfRes = await operator.get(`/api/files/${report.pdfFileId}`, { raw: true })
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf')
    const bytes = Buffer.from(await pdfRes.arrayBuffer())
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    const doc = await PDFDocument.load(bytes)
    assert.equal(doc.getTitle(), `Rapportino ${report.number}`)

    // Rigenerazione: stesso numero, nuovo PDF, vecchio PDF conservato.
    const again = await operator.post(`/api/interventions/${call.id}/report`, { workDone: 'Aggiornato', lines: [], signerName: 'Sofia Gallo', signatureFileId: sig.data.id })
    assert.equal(again.data.report.number, report.number)
    assert.notEqual(again.data.report.pdfFileId, report.pdfFileId)
    assert.deepEqual(again.data.report.previousPdfFileIds, [report.pdfFileId])

    const other = (await operator.post('/api/interventions', { clientId: customer.id, type: 'riparazione', description: 'Forno' })).data
    const second = await operator.post(`/api/interventions/${other.id}/report`, { workDone: 'Sostituita resistenza', lines: [{ description: 'Resistenza', qty: 1, unitPrice: 60 }] })
    assert.match(second.data.report.number, /^R-\d{4}-0002$/)
    assert.equal(second.data.intervention.status, 'pendente', 'senza closeIntervention lo stato non cambia')
  })

  test('validazioni: lavoro svolto obbligatorio, firma senza nome, firma non PNG, permessi', async () => {
    const call = (await operator.post('/api/interventions', { clientId: customer.id, type: 'chiamata', description: 'Frigo' })).data
    assert.equal((await operator.post(`/api/interventions/${call.id}/report`, { workDone: '' })).status, 400)
    const pdf = await operator.post('/api/files?name=a.pdf&type=application/pdf', Buffer.from('%PDF-1.4'), { headers: { 'content-type': 'application/pdf' } })
    assert.equal((await operator.post(`/api/interventions/${call.id}/report`, { workDone: 'ok', signatureFileId: pdf.data.id, signerName: 'A' })).status, 400)
    assert.equal((await operator.post(`/api/interventions/${call.id}/report`, { workDone: 'ok', signatureFileId: pdf.data.id })).status, 400)
    const viewer = await t.loggedIn('VIEWER')
    assert.equal((await viewer.post(`/api/interventions/${call.id}/report`, { workDone: 'ok' })).status, 403)
  })
})
