import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from './helpers.js'

describe('link di stato per il cliente e messaggi', () => {
  let t
  let operator
  let customer
  before(async () => {
    t = await startTestApp()
    operator = await t.loggedIn('OPERATOR')
    const admin = await t.loggedIn('ADMIN')
    await admin.put('/api/shop-profile', { name: 'Elettrodomestici Pesaro', phone: '0721 000000', address: 'Via dei Canonici 12, Pesaro' })
    customer = (await operator.post('/api/customers', { name: 'Neri Paolo', phone: '348 1112233', address: 'Via Segreta 9, Pesaro', email: 'paolo@example.it' })).data
  })
  after(async () => { await t.stop() })

  test('link pubblico: un solo link attivo, dati minimi senza login, avanzamento stati, revoca', async () => {
    const rep = (await operator.post('/api/interventions', { clientId: customer.id, type: 'riparazione', description: 'Nota interna: cliente difficile', additionalData: { applianceBrand: 'Candy', applianceModel: 'GVS 1410', defect: 'Non centrifuga' } })).data
    const link = await operator.post(`/api/interventions/${rep.id}/public-link`)
    assert.equal(link.status, 201)
    assert.match(link.data.path, /^\/s\/[A-Za-z0-9_-]{20,}$/)
    const same = await operator.post(`/api/interventions/${rep.id}/public-link`)
    assert.equal(same.status, 200)
    assert.equal(same.data.token, link.data.token)

    const anonymous = t.client()
    const view = await anonymous.get(`/api/public/status/${link.data.token}`)
    assert.equal(view.status, 200)
    assert.equal(view.data.appliance, 'Candy GVS 1410')
    assert.equal(view.data.shop.name, 'Elettrodomestici Pesaro')
    assert.equal(view.data.steps[0].current, true)
    const raw = JSON.stringify(view.data)
    for (const secret of ['Neri', 'Via Segreta', '348', 'paolo@', 'cliente difficile']) assert.ok(!raw.includes(secret), `non deve esporre "${secret}"`)

    await operator.patch(`/api/interventions/${rep.id}`, { status: 'in_lavorazione' })
    let steps = (await anonymous.get(`/api/public/status/${link.data.token}`)).data.steps
    assert.deepEqual(steps.map((s) => [s.done, s.current]), [[true, false], [false, true], [false, false]])
    assert.ok(steps[1].at)
    await operator.patch(`/api/interventions/${rep.id}`, { status: 'completato' })
    steps = (await anonymous.get(`/api/public/status/${link.data.token}`)).data.steps
    assert.ok(steps.every((s) => s.done))
    assert.equal(steps[2].label, 'Pronto per il ritiro')
    assert.equal((await operator.get(`/api/interventions/${rep.id}/public-link`)).data.views, 3)

    // Rapportino scaricabile dal link pubblico.
    await operator.post(`/api/interventions/${rep.id}/report`, { workDone: 'Sostituiti carboncini motore', lines: [{ description: 'Carboncini', qty: 1, unitPrice: 25 }] })
    const withReport = await anonymous.get(`/api/public/status/${link.data.token}`)
    assert.equal(withReport.data.report.total, 25)
    const pdf = await anonymous.get(`/api/public/status/${link.data.token}/report.pdf`, { raw: true })
    assert.equal(pdf.headers.get('content-type'), 'application/pdf')

    assert.equal((await operator.del(`/api/interventions/${rep.id}/public-link`)).status, 204)
    assert.equal((await anonymous.get(`/api/public/status/${link.data.token}`)).status, 404)
    const fresh = await operator.post(`/api/interventions/${rep.id}/public-link`)
    assert.notEqual(fresh.data.token, link.data.token)
  })

  test('token falsi o inventati: 404, nessun accesso ai file interni', async () => {
    const anonymous = t.client()
    assert.equal((await anonymous.get('/api/public/status/abc')).status, 404)
    assert.equal((await anonymous.get('/api/public/status/AAAAAAAAAAAAAAAAAAAAAA')).status, 404)
    assert.equal((await anonymous.get('/api/files/qualsiasi')).status, 401)
  })

  test('chiamata: appuntamento visibile, storico dei messaggi al cliente', async () => {
    const openedAt = '2026-12-02T09:30:00.000Z'
    const call = (await operator.post('/api/interventions', { clientId: customer.id, type: 'chiamata', openedAt, description: 'Forno' })).data
    const link = (await operator.post(`/api/interventions/${call.id}/public-link`)).data
    const view = (await t.client().get(`/api/public/status/${link.token}`)).data
    assert.equal(new Date(view.appointmentAt).toISOString(), openedAt)
    assert.equal(view.steps[0].label, 'Richiesta ricevuta')

    assert.equal((await operator.post(`/api/interventions/${call.id}/customer-message`, { channel: 'whatsapp', template: 'Conferma appuntamento' })).status, 201)
    const logs = (await operator.get(`/api/interventions/${call.id}`)).data.logs
    assert.ok(logs.some((l) => l.action === 'cliente_avvisato' && l.note === 'whatsapp · Conferma appuntamento'))
    const viewer = await t.loggedIn('VIEWER')
    assert.equal((await viewer.post(`/api/interventions/${call.id}/public-link`)).status, 403)
  })
})
