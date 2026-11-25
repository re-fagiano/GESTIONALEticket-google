import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from './helpers.js'
import { createFakeGoogle } from './fakeGoogle.js'
import { googleExtension } from '../server/routes/google.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

describe('allegati fuori dal database degli interventi', () => {
  let t
  let admin
  let fake
  let customer
  before(async () => {
    fake = createFakeGoogle()
    t = await startTestApp({
      env: { GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret', PUBLIC_URL: 'https://fixlab.example' },
      fetchImpl: fake.fetchImpl,
      extensions: [googleExtension],
    })
    admin = await t.loggedIn('ADMIN')
    customer = (await admin.post('/api/customers', { name: 'Bianchi Luca', phone: '333 7654321' })).data
  })
  after(async () => { await t.stop() })

  test('upload binario, download con tipo e nome corretti, tipi non ammessi rifiutati', async () => {
    const up = await admin.post('/api/files?name=targhetta.png&type=image/png', PNG, { headers: { 'content-type': 'image/png' } })
    assert.equal(up.status, 201)
    assert.equal(up.data.size, PNG.length)
    const res = await admin.get(`/api/files/${up.data.id}`, { raw: true })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)

    const bad = await admin.post('/api/files?name=x.exe&type=application/x-msdownload', Buffer.from('MZ'), { headers: { 'content-type': 'application/x-msdownload' } })
    assert.equal(bad.status, 400)

    const viewer = await t.loggedIn('VIEWER')
    const denied = await viewer.post('/api/files?name=a.png&type=image/png', PNG, { headers: { 'content-type': 'image/png' } })
    assert.equal(denied.status, 403)
    assert.equal((await viewer.get(`/api/files/${up.data.id}`, { raw: true })).status, 200)
  })

  test('i vecchi allegati in base64 vengono spostati nella tabella files', async () => {
    const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`
    const created = (await admin.post('/api/interventions', {
      clientId: customer.id, type: 'riparazione', description: 'Lavastoviglie',
      additionalData: { applianceBrand: 'Bosch', attachments: [{ id: 'a1', fileName: 'foto.png', mimeType: 'image/png', size: PNG.length, dataUrl }] },
    })).data
    const moved = await t.deps.files.migrateInlineAttachments()
    assert.equal(moved, 1)
    const row = await t.db.one('SELECT "additionalData" FROM "interventions" WHERE "id" = $1', [created.id])
    const [att] = row.additionalData.attachments
    assert.equal(att.dataUrl, undefined)
    assert.equal(att.id, 'a1')
    assert.equal(row.additionalData.applianceBrand, 'Bosch')
    const file = await t.db.one('SELECT * FROM "files" WHERE "id" = $1', [att.fileId])
    assert.deepEqual(file.data, PNG)
    assert.equal(file.interventionId, created.id)
    assert.equal(await t.deps.files.migrateInlineAttachments(), 0, 'seconda esecuzione: niente da fare')
  })

  test('backup quotidiano: gli allegati nuovi vanno su Drive una sola volta (incrementale)', async () => {
    const state = new URL((await admin.get('/api/google/connect')).data.url).searchParams.get('state')
    await admin.get(`/api/google/callback?code=abc&state=${state}`, { raw: true })
    const pending = Number((await t.db.one('SELECT COUNT(*)::int AS n FROM "files" WHERE "backedUpAt" IS NULL')).n)
    assert.ok(pending >= 2)

    const first = await t.backup.perform({ triggeredBy: 'test' })
    assert.equal(first.ok, true, first.message)
    const uploadedNames = fake.driveFiles.map((f) => f.name)
    assert.ok(uploadedNames.some((n) => n.endsWith('targhetta.png')))
    assert.equal((await t.db.one('SELECT COUNT(*)::int AS n FROM "files" WHERE "backedUpAt" IS NULL')).n, 0)

    // Il JSON del database non contiene i binari degli allegati.
    const json = fake.driveFiles.find((f) => f.name.startsWith('backup-'))
    assert.ok(!json.content.includes(PNG.toString('base64')))

    const before = fake.driveFiles.length
    await t.backup.perform({ triggeredBy: 'test' })
    const added = fake.driveFiles.slice(before).map((f) => f.name)
    assert.ok(!added.some((n) => n.endsWith('.png')), 'gli allegati già copiati non vengono ricaricati')
  })
})
