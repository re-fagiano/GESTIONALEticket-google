import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from './helpers.js'
import { createFakeGoogle } from './fakeGoogle.js'
import { googleExtension } from '../server/routes/google.js'

describe('Google: collegamento account, ponte Calendar, backup Drive', () => {
  let t
  let admin
  let fake
  let customer
  let sync

  before(async () => {
    fake = createFakeGoogle()
    t = await startTestApp({
      env: { GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret', PUBLIC_URL: 'https://fixlab.example' },
      fetchImpl: fake.fetchImpl,
      extensions: [googleExtension],
    })
    admin = await t.loggedIn('ADMIN')
    sync = t.deps.calendarSync
    customer = (await admin.post('/api/customers', { name: 'Rossi Maria', phone: '333 1234567', address: 'Via Roma 12, Pesaro' })).data
  })
  after(async () => { await t.stop() })

  test('collegamento OAuth: consenso, callback con controllo state, refresh token cifrato', async () => {
    const status = await admin.get('/api/google/status')
    assert.equal(status.data.mode, 'none')
    assert.equal(status.data.redirectUri, 'https://fixlab.example/api/google/callback')

    const connect = await admin.get('/api/google/connect')
    const consent = new URL(connect.data.url)
    assert.equal(consent.host, 'accounts.google.com')
    assert.equal(consent.searchParams.get('access_type'), 'offline')
    assert.match(consent.searchParams.get('scope'), /calendar/)
    const state = consent.searchParams.get('state')

    const forged = await admin.get('/api/google/callback?code=abc&state=falso', { raw: true })
    assert.equal(forged.status, 302)
    assert.match(forged.headers.get('location'), /error=state_non_valido/)

    // il cookie state è stato cancellato dal tentativo falso: ne chiediamo uno nuovo
    const again = new URL((await admin.get('/api/google/connect')).data.url).searchParams.get('state')
    assert.notEqual(again, state)
    const ok = await admin.get(`/api/google/callback?code=abc&state=${again}`, { raw: true })
    assert.match(ok.headers.get('location'), /connected=1/)

    const stored = await t.db.one(`SELECT "value" FROM "app_settings" WHERE "key" = 'google.oauth.refreshToken'`)
    assert.equal(stored.value.enc, 'v1')
    assert.ok(!JSON.stringify(stored.value).includes('refresh-abc'), 'il refresh token non è salvato in chiaro')

    const after = await admin.get('/api/google/status')
    assert.equal(after.data.mode, 'oauth')
    assert.equal(after.data.account.email, 'negozio@gmail.com')
    const calendars = await admin.get('/api/google/calendars')
    assert.equal(calendars.data.length, 2)
  })

  test('solo ADMIN gestisce il collegamento Google', async () => {
    const operator = await t.loggedIn('OPERATOR')
    assert.equal((await operator.get('/api/google/status')).status, 403)
    assert.equal((await operator.put('/api/google/calendar/settings', { enabled: true })).status, 403)
  })

  test('attivazione: gli interventi esistenti finiscono su Google con cliente, indirizzo e link', async () => {
    const call = (await admin.post('/api/interventions', { clientId: customer.id, type: 'chiamata', urgency: 3, openedAt: '2026-12-01T09:00:00.000Z', description: 'Lavatrice non scarica' })).data
    await admin.post('/api/interventions', { clientId: customer.id, type: 'riparazione', openedAt: '2026-12-01T11:00:00.000Z' })
    const old = (await admin.post('/api/interventions', { clientId: customer.id, type: 'chiamata', openedAt: '2026-12-01T08:00:00.000Z', description: 'già scritta a mano su Google' })).data
    await t.db.query(`UPDATE "interventions" SET "createdAt" = NOW() - interval '1 hour' WHERE "id" IN ($1, $2)`, [old.id, call.id])
    const settings = await admin.put('/api/google/calendar/settings', { enabled: true, calendarId: 'interventi@group.calendar.google.com', pushTypes: ['chiamata'] })
    assert.ok(settings.data.pushSince, 'attivazione: si parte da adesso')
    await sync.idle()
    assert.equal(fake.live().length, 0, 'le chiamate già esistenti non vengono inviate (eviterebbe doppioni)')
    await admin.put('/api/google/calendar/settings', { pushExisting: true })
    assert.equal(settings.data.enabled, true)
    const report = await admin.post('/api/google/calendar/sync')
    assert.equal(report.status, 200)
    // l'attivazione avvia già un giro in background; quello manuale aspetta il suo turno
    assert.equal(fake.live().filter((e) => e.extendedProperties?.private?.fixlabType === 'intervention').length, 2, 'solo le chiamate (tipo scelto), incluse quelle vecchie su richiesta')

    const event = fake.find((e) => e.extendedProperties?.private?.fixlabId === call.id)
    assert.equal(event.calendarId, 'interventi@group.calendar.google.com')
    assert.equal(event.summary, '[Chiamata] Rossi Maria — Lavatrice non scarica')
    assert.equal(event.location, 'Via Roma 12, Pesaro')
    assert.equal(event.start.dateTime, '2026-12-01T09:00:00.000Z')
    assert.equal(event.end.dateTime, '2026-12-01T10:00:00.000Z')
    assert.equal(event.colorId, '11', 'urgente = rosso')
    assert.match(event.description, /333 1234567/)
    assert.match(event.description, new RegExp(`https://fixlab.example/#/chiamate\\?id=${call.id}`))

    const link = await admin.get(`/api/google/calendar/link/intervention/${call.id}`)
    assert.match(link.data.htmlLink, /calendar.google.com/)

    // attivazione + sincronizzazione manuale in contemporanea: nessun evento doppio
    assert.equal(fake.live().filter((e) => e.extendedProperties?.private?.fixlabId === call.id).length, 1)

    // un secondo giro senza modifiche non riscrive nulla
    const second = await admin.post('/api/google/calendar/sync')
    assert.equal(second.data.pushed.created, 0)
    assert.equal(second.data.pushed.updated, 0)
  })

  test('modifiche nel gestionale: spostamento, completamento e annullamento arrivano su Google', async () => {
    const call = (await admin.post('/api/interventions', { clientId: customer.id, type: 'chiamata', openedAt: '2026-12-02T08:00:00.000Z', description: 'Frigo' })).data
    await sync.idle()
    let event = fake.find((e) => e.extendedProperties?.private?.fixlabId === call.id)
    assert.ok(event, 'creato subito dopo il salvataggio')

    await admin.patch(`/api/interventions/${call.id}`, { openedAt: '2026-12-02T14:30:00.000Z' })
    await sync.idle()
    event = fake.find((e) => e.id === event.id)
    assert.equal(event.start.dateTime, '2026-12-02T14:30:00.000Z')

    await admin.patch(`/api/interventions/${call.id}`, { status: 'completato' })
    await sync.idle()
    event = fake.find((e) => e.id === event.id)
    assert.match(event.summary, /^✔ /)

    await admin.patch(`/api/interventions/${call.id}`, { status: 'annullato' })
    await sync.idle()
    assert.equal(fake.find((e) => e.id === event.id).status, 'cancelled')
  })

  test('modifiche su Google: un evento spostato sposta l\'appuntamento, senza rimbalzi', async () => {
    const call = (await admin.post('/api/interventions', { clientId: customer.id, type: 'chiamata', openedAt: '2026-12-03T09:00:00.000Z' })).data
    await sync.idle()
    const event = fake.find((e) => e.extendedProperties?.private?.fixlabId === call.id)
    const writesBefore = fake.calls.filter((c) => c.startsWith('PATCH')).length

    fake.userMove(event.id, '2026-12-04T15:00:00.000Z', '2026-12-04T16:30:00.000Z')
    const pulled = await sync.pullNow()
    assert.equal(pulled.movedInterventions, 1)
    const updated = (await admin.get(`/api/interventions/${call.id}`)).data
    assert.equal(updated.openedAt, '2026-12-04T15:00:00.000Z')
    assert.equal(updated.additionalData.durationMinutes, 90)
    assert.ok(updated.logs.some((log) => log.action === 'spostato_da_google'))

    // la lettura successiva e un giro completo non devono riscrivere l'evento su Google
    await sync.pullNow()
    await admin.post('/api/google/calendar/sync')
    assert.equal(fake.calls.filter((c) => c.startsWith('PATCH')).length, writesBefore)
  })

  test('eventi creati direttamente su Google compaiono nel calendario dell\'app e seguono le modifiche', async () => {
    const created = fake.userCreate('interventi@group.calendar.google.com', {
      summary: 'Fornitore Ricambi Adriatica', start: { dateTime: '2026-12-05T10:00:00.000Z' }, end: { dateTime: '2026-12-05T10:30:00.000Z' }, location: 'Pesaro',
    })
    const allDay = fake.userCreate('interventi@group.calendar.google.com', { summary: 'Chiusura per ferie', start: { date: '2026-12-24' }, end: { date: '2026-12-27' } })
    const pulled = await sync.pullNow()
    assert.equal(pulled.importedEvents, 2)

    const items = (await admin.get('/api/calendar?from=2026-12-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z')).data
    const supplier = items.find((i) => i.title === 'Fornitore Ricambi Adriatica')
    assert.equal(supplier.source, 'google')
    assert.equal(new Date(supplier.startAt).toISOString(), '2026-12-05T10:00:00.000Z')
    const holiday = items.find((i) => i.title === 'Chiusura per ferie')
    assert.equal(holiday.allDay, true)

    // spostato nel gestionale → aggiornato anche su Google
    await admin.patch(`/api/calendar/${supplier.id}`, { startAt: '2026-12-05T11:00:00.000Z', endAt: '2026-12-05T11:30:00.000Z' })
    await sync.idle()
    assert.equal(fake.find((e) => e.id === created.id).start.dateTime, '2026-12-05T11:00:00.000Z')

    // eliminato su Google → sparisce dal gestionale
    fake.userDelete(allDay.id)
    const afterDelete = await sync.pullNow()
    assert.equal(afterDelete.deletedEvents, 1)
    assert.equal((await t.db.one('SELECT COUNT(*)::int AS n FROM "calendar_items" WHERE "title" = $1', ['Chiusura per ferie'])).n, 0)
  })

  test('eventi scritti a mano su Google diventano chiamate: cliente dal telefono, tecnico dal colore', async () => {
    const tecnico = await t.createUser({ email: 'andrea@test.it', role: 'OPERATOR' })
    await admin.put('/api/google/calendar/settings', { importAsCalls: true, colorOperators: { 5: tecnico.id } })
    await sync.idle()
    const cal = 'interventi@group.calendar.google.com'
    const first = fake.userCreate(cal, {
      summary: 'Bianchi Luca via Mazzini 8', colorId: '5',
      description: 'stati 18/11\n3391112222\nlavatrice non centrifuga, molla 480111100817 da astelav',
      start: { dateTime: '2026-12-09T10:00:00.000Z' }, end: { dateTime: '2026-12-09T11:00:00.000Z' },
    })
    const second = fake.userCreate(cal, {
      summary: 'Bianchi via Mazzini 8 (ritorno)', description: 'tel 339 111 2222 portare ricambio',
      start: { dateTime: '2026-12-10T15:00:00.000Z' }, end: { dateTime: '2026-12-10T15:30:00.000Z' },
    })
    const note = fake.userCreate(cal, { summary: 'chiamate Angelo solo da questi orari', start: { dateTime: '2026-12-11T07:00:00.000Z' }, end: { dateTime: '2026-12-11T10:00:00.000Z' } })
    const report = await sync.pullNow()
    assert.equal(report.importedCalls, 2)
    assert.equal(report.createdCustomers, 1, 'il secondo evento riconosce il cliente dal telefono')

    const calls = (await admin.get('/api/chiamate?q=bianchi')).data
    assert.equal(calls.length, 2)
    const imported = calls.find((c) => c.openedAt === '2026-12-09T10:00:00.000Z')
    assert.equal(imported.status, 'pendente')
    assert.equal(imported.assignedToId, tecnico.id, 'colore Banana = tecnico Andrea')
    assert.match(imported.description, /480111100817/)
    const customer = (await admin.get(`/api/customers/${imported.customerId}`)).data
    assert.equal(customer.name, 'Bianchi Luca')
    assert.equal(customer.address, 'via Mazzini 8')
    assert.equal(customer.phone, '3391112222')
    assert.equal((await t.db.one('SELECT COUNT(*)::int AS n FROM "calendar_items" WHERE "title" = $1', ['chiamate Angelo solo da questi orari'])).n, 1, 'gli appunti restano eventi')
    assert.ok(note)

    // spostata nel gestionale: su Google cambia solo l'orario, titolo e descrizione restano quelli scritti a mano
    await admin.patch(`/api/interventions/${imported.id}`, { openedAt: '2026-12-09T16:00:00.000Z' })
    await sync.idle()
    const onGoogle = fake.find((e) => e.id === first.id)
    assert.equal(onGoogle.start.dateTime, '2026-12-09T16:00:00.000Z')
    assert.equal(onGoogle.summary, 'Bianchi Luca via Mazzini 8')
    assert.match(onGoogle.description, /molla 480111100817/)

    // nota aggiunta su Google → arriva nella chiamata; nessun rimbalzo
    const patchesBefore = fake.calls.filter((c) => c.startsWith('PATCH')).length
    fake.userMove(second.id, '2026-12-10T15:00:00.000Z', '2026-12-10T15:30:00.000Z')
    const edited = fake.find((e) => e.id === second.id)
    edited.description = 'tel 339 111 2222 portare ricambio — FATTO pagato 80€'
    fake.userMove(second.id, '2026-12-10T15:00:00.000Z', '2026-12-10T15:30:00.000Z')
    await sync.pullNow()
    const ritorno = (await admin.get('/api/chiamate?q=ritorno')).data[0]
    assert.ok(ritorno, 'la ricerca trova anche il titolo scritto su Google')
    assert.match(ritorno.description, /FATTO pagato 80€/, 'la nota scritta su Google arriva nella chiamata')
    await sync.idle()
    assert.equal(fake.calls.filter((c) => c.startsWith('PATCH')).length, patchesBefore)

    // chiamata creata nel gestionale e assegnata ad Andrea → su Google con il suo colore
    const nuova = (await admin.post('/api/interventions', { clientId: customer.id, type: 'chiamata', assignedToId: tecnico.id, openedAt: '2026-12-12T09:00:00.000Z', description: 'Forno' })).data
    await sync.idle()
    assert.equal(fake.find((e) => e.extendedProperties?.private?.fixlabId === nuova.id).colorId, '5')
    await admin.put('/api/google/calendar/settings', { colorOperators: {} })
  })

  test('evento di un intervento eliminato a mano su Google non viene ricreato (salvo richiesta)', async () => {
    const call = (await admin.post('/api/interventions', { clientId: customer.id, type: 'chiamata', openedAt: '2026-12-06T09:00:00.000Z' })).data
    await sync.idle()
    const event = fake.find((e) => e.extendedProperties?.private?.fixlabId === call.id)
    fake.userDelete(event.id)
    const pulled = await sync.pullNow()
    assert.equal(pulled.detached, 1)
    await admin.patch(`/api/interventions/${call.id}`, { description: 'aggiornato' })
    await sync.idle()
    assert.equal(fake.live().filter((e) => e.extendedProperties?.private?.fixlabId === call.id).length, 0)

    const forced = await admin.post('/api/google/calendar/sync', { recreateDeleted: true })
    assert.ok(forced.data.pushed.created >= 1)
    assert.equal(fake.live().filter((e) => e.extendedProperties?.private?.fixlabId === call.id).length, 1)
  })

  test('syncToken scaduto (410): risincronizzazione completa automatica', async () => {
    await t.db.query(`UPDATE "app_settings" SET "value" = jsonb_set("value", '{syncToken}', '"scaduto"') WHERE "key" = 'google.calendar.state'`)
    const pulled = await sync.pullNow()
    assert.ok(pulled, 'nessun errore')
    const status = (await admin.get('/api/google/status')).data.calendar
    assert.equal(status.state.lastError, null)
    assert.equal(status.state.hasSyncToken, true)
  })

  test('cambio calendario: gli eventi vengono spostati sul nuovo calendario', async () => {
    await admin.put('/api/google/calendar/settings', { calendarId: 'primary-id' })
    await admin.post('/api/google/calendar/sync')
    const onNew = fake.live().filter((e) => e.calendarId === 'primary-id' && e.extendedProperties?.private?.fixlabType === 'intervention')
    const onOld = fake.live().filter((e) => e.calendarId === 'interventi@group.calendar.google.com' && e.extendedProperties?.private?.fixlabType === 'intervention')
    assert.ok(onNew.length >= 2)
    assert.deepEqual(onOld.map((e) => [e.id, e.summary]), [])
  })

  test('con Google collegato il backup va davvero su Drive', async () => {
    const res = await admin.post('/api/admin/backup')
    assert.equal(res.status, 200)
    assert.equal(res.data.result.mode, 'drive')
    assert.equal(res.data.lastRun.status, 'success')
    assert.equal(fake.driveFiles.length, 1)
  })

  test('scollega: token revocato e sincronizzazione disattivata', async () => {
    const res = await admin.post('/api/google/disconnect')
    assert.equal(res.status, 200)
    const status = (await admin.get('/api/google/status')).data
    assert.equal(status.mode, 'none')
    assert.equal(status.calendar.settings.enabled, false)
    assert.ok(fake.calls.includes('POST /revoke'))
  })
})
