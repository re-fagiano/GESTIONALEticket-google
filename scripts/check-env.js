const requiredInProduction = ['API_TOKEN']

const missing = requiredInProduction.filter((name) => !process.env[name])

if (process.env.NODE_ENV === 'production' && missing.length > 0) {
  console.error(`Variabili ambiente mancanti: ${missing.join(', ')}`)
  process.exit(1)
}

console.log('Check env completato.')
