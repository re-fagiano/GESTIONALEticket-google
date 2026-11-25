#!/usr/bin/env node
// Promuove un utente esistente ad ADMIN (e lo approva). Uso:
//   DATABASE_URL=... node scripts/promote-user-admin.js <email>
import { loadConfig } from '../server/config.js'
import { createDb } from '../server/db.js'

const email = (process.argv[2] || '').trim().toLowerCase()
if (!email) {
  console.error('Uso: node scripts/promote-user-admin.js <email>')
  process.exit(1)
}

const config = loadConfig()
if (!config.DATABASE_URL) {
  console.error('DATABASE_URL non impostata.')
  process.exit(1)
}

const db = createDb(config.DATABASE_URL, { max: 1 })
try {
  const row = await db.one(
    `UPDATE "users" SET "role" = 'ADMIN', "approved" = true, "status" = 'active', "updatedAt" = NOW() WHERE "email" = $1 RETURNING "email", "role"`,
    [email],
  )
  if (!row) {
    console.error(`Utente non trovato: ${email}`)
    process.exitCode = 1
  } else {
    console.log(`Ruolo aggiornato: ${row.email} -> ${row.role}`)
  }
} finally {
  await db.close()
}
