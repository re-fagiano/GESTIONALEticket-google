import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMessage, isMobile, normalizePhone, suggestedTemplate, whatsappUrl } from '../src/lib/messages.js'

test('numeri italiani normalizzati per WhatsApp', () => {
  assert.equal(normalizePhone('333 1234567'), '393331234567')
  assert.equal(normalizePhone('+39 333-123.4567'), '393331234567')
  assert.equal(normalizePhone('0039 3331234567'), '393331234567')
  assert.equal(normalizePhone('0721 123456'), '390721123456')
  assert.equal(normalizePhone(''), '')
  assert.equal(normalizePhone('abc'), '')
  assert.ok(isMobile('333 1234567'))
  assert.ok(!isMobile('0721 123456'))
  assert.match(whatsappUrl('333 1234567', 'Ciao è pronto'), /^https:\/\/wa\.me\/393331234567\?text=Ciao%20%C3%A8%20pronto$/)
})

test('testi suggeriti in base a tipo e stato', () => {
  const shop = { name: 'Elettrodomestici Pesaro', phone: '0721 000000', address: 'Via dei Canonici 12' }
  const customer = { name: 'Rossi Maria' }
  const repair = { code: 'INV-1', type: 'riparazione', status: 'completato', openedAt: '2026-12-01T09:00:00Z', additionalData: { applianceBrand: 'Bosch', report: { number: 'R-2026-0001', total: 75 } } }
  assert.equal(suggestedTemplate(repair), 'pronto')
  const text = buildMessage('pronto', { item: repair, customer, shop, link: 'https://x/s/abc' })
  assert.match(text, /Bosch è pronto per il ritiro/)
  assert.match(text, /75,00/)
  assert.match(text, /https:\/\/x\/s\/abc/)
  assert.match(text, /Elettrodomestici Pesaro · 0721 000000$/)
  const call = { code: 'INV-2', type: 'chiamata', status: 'pendente', openedAt: '2026-12-02T09:30:00Z', additionalData: {} }
  assert.equal(suggestedTemplate(call), 'appuntamento')
  assert.match(buildMessage('appuntamento', { item: call, customer, shop, link: 'L' }), /mercoledì 2 dicembre alle 10:30/)
})
