// Check ambiente: blocca deploy quando mancano variabili critiche.
// Rollback: ridurre l'elenco `requiredInProduction` per deploy permissivo.
const requiredInProduction = ['API_TOKEN', 'DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']

const missing = requiredInProduction.filter((name) => !process.env[name])

if (process.env.NODE_ENV === 'production' && missing.length > 0) {
  console.error(`Variabili ambiente mancanti: ${missing.join(', ')}`)
  process.exit(1)
}

console.log('Check env completato.')
