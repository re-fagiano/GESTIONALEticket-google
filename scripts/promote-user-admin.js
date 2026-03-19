#!/usr/bin/env node
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config.js'

const emailArg = (process.argv[2] || '').trim().toLowerCase()
const passwordArg = process.argv[3] || ''

if (!emailArg || !passwordArg) {
  console.error('Uso: node scripts/promote-user-admin.js <email> <password>')
  process.exit(1)
}

const verifyPassword = (password, storedHash) => {
  if (!storedHash || typeof storedHash !== 'string') return false
  try {
    if (!storedHash.startsWith('scrypt$')) return false
    const [, saltHex, keyHex] = storedHash.split('$')
    if (!saltHex || !keyHex) return false
    const computed = crypto.scryptSync(String(password || ''), Buffer.from(saltHex, 'hex'), 64)
    const expected = Buffer.from(keyHex, 'hex')
    if (computed.length !== expected.length) return false
    return crypto.timingSafeEqual(computed, expected)
  } catch {
    return false
  }
}

const db = new DatabaseSync(config.DB_PATH)
const user = db.prepare('SELECT id, email, password_hash, role FROM users WHERE LOWER(email) = ?').get(emailArg)
if (!user) {
  console.error(`Utente non trovato: ${emailArg}`)
  process.exit(1)
}

const passwordOk = verifyPassword(passwordArg, String(user.password_hash || ''))
if (!passwordOk) {
  console.error('Password non valida: promozione annullata.')
  process.exit(1)
}

if (String(user.role).toUpperCase() === 'ADMIN') {
  console.log(`L'utente ${emailArg} è già admin.`)
  process.exit(0)
}

const now = new Date().toISOString()
db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run('ADMIN', now, user.id)
const updated = db.prepare('SELECT email, role, updated_at FROM users WHERE id = ?').get(user.id)
console.log(`Ruolo aggiornato con successo: ${updated.email} -> ${updated.role} (${updated.updated_at})`)
