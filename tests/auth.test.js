import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestApp } from './helpers.js'

describe('autenticazione e permessi', () => {
  let t
  before(async () => { t = await startTestApp() })
  after(async () => { await t.stop() })

  test('login, /me, refresh e logout', async () => {
    await t.createUser({ email: 'mario@test.it', role: 'OPERATOR' })
    const c = t.client()
    const login = await c.login('mario@test.it')
    assert.equal(login.data.user.email, 'mario@test.it')
    assert.equal(login.data.user.role, 'OPERATOR')
    assert.ok(c.jar.has('access_token') && c.jar.has('refresh_token') && c.jar.has('csrf_token'))

    const me = await c.get('/api/auth/me')
    assert.equal(me.data.user.email, 'mario@test.it')

    const refreshed = await c.post('/api/auth/refresh')
    assert.equal(refreshed.status, 200)
    const oldRefresh = c.jar.get('refresh_token')
    assert.ok(oldRefresh)

    const logout = await c.post('/api/auth/logout')
    assert.equal(logout.status, 200)
    assert.equal((await c.get('/api/auth/me')).data.user, null)
  })

  test('password errata e utente inesistente danno lo stesso errore', async () => {
    await t.createUser({ email: 'luigi@test.it' })
    const c = t.client()
    const wrong = await c.post('/api/auth/login', { email: 'luigi@test.it', password: 'sbagliata' })
    const missing = await c.post('/api/auth/login', { email: 'nessuno@test.it', password: 'sbagliata' })
    assert.equal(wrong.status, 401)
    assert.equal(missing.status, 401)
    assert.equal(wrong.data.error, missing.data.error)
  })

  test('registrazione crea utente in attesa di approvazione', async () => {
    const c = t.client()
    const res = await c.post('/api/auth/register', { email: 'nuovo@test.it', password: 'password123' })
    assert.equal(res.status, 201)
    assert.equal(res.data.pendingApproval, true)
    const login = await c.post('/api/auth/login', { email: 'nuovo@test.it', password: 'password123' })
    assert.equal(login.status, 403)
    assert.equal(login.data.code, 'user_not_approved')
  })

  test('API protette: 401 senza login, 403 senza CSRF', async () => {
    const anon = t.client()
    assert.equal((await anon.get('/api/customers')).status, 401)
    const admin = await t.loggedIn('ADMIN')
    const noCsrf = await admin.post('/api/customers', { name: 'X' }, { headers: { 'x-csrf-token': 'falso' } })
    assert.equal(noCsrf.status, 403)
    assert.equal(noCsrf.data.code, 'invalid_csrf')
  })

  test('VIEWER può leggere ma non scrivere', async () => {
    const viewer = await t.loggedIn('VIEWER')
    assert.equal((await viewer.get('/api/inventory')).status, 200)
    assert.equal((await viewer.post('/api/customers', { name: 'Prova' })).status, 403)
  })

  test('solo ADMIN gestisce gli utenti; un admin non può declassarsi', async () => {
    const operator = await t.loggedIn('OPERATOR')
    assert.equal((await operator.get('/api/admin/users')).status, 403)
    const admin = await t.loggedIn('ADMIN')
    const users = await admin.get('/api/admin/users')
    assert.equal(users.status, 200)
    assert.ok(users.data.users.length >= 2)
    const self = await admin.patch(`/api/admin/users/${admin.user.id}`, { role: 'OPERATOR', approved: true, status: 'active' })
    assert.equal(self.data.code, 'self_demotion_not_allowed')
    const disabled = await admin.patch(`/api/admin/users/${operator.user.id}`, { role: 'OPERATOR', approved: false, status: 'disabled' })
    assert.equal(disabled.data.user.status, 'disabled')
    // il refresh token dell'operatore disabilitato non funziona più
    assert.equal((await operator.post('/api/auth/refresh')).status, 401)
  })
})
