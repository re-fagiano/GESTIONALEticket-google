import { api, fetchAll } from './api'

// Recupero dei dati rimasti nella cache del browser della vecchia interfaccia (v1).
// La v1 salvava tutto anche in IndexedDB "gestionale-ticket-db-v3" (store "kv") e in localStorage
// (chiavi cache_*). Alcuni ticket esistevano SOLO lì, perché il server li scriveva su un disco
// temporaneo. Qui li confrontiamo con il server e carichiamo quelli mancanti.

const KEYS = ['cache_customers', 'cache_tickets', 'cache_interventions']

const readIndexedDb = () => new Promise((resolve) => {
  if (!window.indexedDB) return resolve({})
  const request = window.indexedDB.open('gestionale-ticket-db-v3')
  request.onerror = () => resolve({})
  request.onupgradeneeded = () => { request.transaction?.abort(); resolve({}) } // il database non esisteva
  request.onsuccess = () => {
    const db = request.result
    if (!db.objectStoreNames.contains('kv')) { db.close(); return resolve({}) }
    const out = {}
    const tx = db.transaction('kv', 'readonly')
    const store = tx.objectStore('kv')
    KEYS.forEach((key) => {
      const get = store.get(key)
      get.onsuccess = () => { if (get.result !== undefined) out[key] = get.result }
    })
    tx.oncomplete = () => { db.close(); resolve(out) }
    tx.onerror = () => { db.close(); resolve(out) }
  }
})

const readLocalStorage = () => Object.fromEntries(KEYS.map((key) => {
  try { return [key, JSON.parse(window.localStorage.getItem(key) || 'null')] } catch { return [key, null] }
}).filter(([, value]) => value))

const asArray = (value) => (Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [])

export const scanLegacyData = async () => {
  const [idb, local] = [await readIndexedDb(), readLocalStorage()]
  const merged = (key) => {
    const byId = new Map()
    for (const row of [...asArray(local[key]), ...asArray(idb[key])]) if (row?.id) byId.set(row.id, row)
    return [...byId.values()]
  }
  const local_ = { customers: merged('cache_customers'), tickets: merged('cache_tickets'), interventions: merged('cache_interventions') }
  if (!local_.customers.length && !local_.tickets.length && !local_.interventions.length) return { found: false, missing: { customers: [], tickets: [], interventions: [] } }

  const [serverCustomers, serverTickets, serverInterventions] = await Promise.all([
    fetchAll('/api/customers'), fetchAll('/api/tickets'), fetchAll('/api/interventions', { light: 1 }),
  ])
  const has = (rows) => new Set(rows.map((row) => row.id))
  const [c, t, i] = [has(serverCustomers), has(serverTickets), has(serverInterventions)]
  return {
    found: true,
    missing: {
      customers: local_.customers.filter((row) => !c.has(row.id) && row.name),
      tickets: local_.tickets.filter((row) => !t.has(row.id) && row.subject),
      interventions: local_.interventions.filter((row) => !i.has(row.id) && (row.clientId || row.customerId) && row.type),
    },
  }
}

export const uploadLegacyData = async (missing) => {
  const result = { customers: 0, tickets: 0, interventions: 0, errors: [] }
  for (const customer of missing.customers) {
    try { await api.post('/api/customers', customer); result.customers += 1 } catch (error) { result.errors.push(`Cliente ${customer.name}: ${error.message}`) }
  }
  for (const ticket of missing.tickets) {
    try { await api.put(`/api/tickets/${encodeURIComponent(ticket.id)}`, ticket); result.tickets += 1 } catch (error) { result.errors.push(`Ticket ${ticket.subject}: ${error.message}`) }
  }
  for (const intervention of missing.interventions) {
    try { await api.post('/api/interventions', intervention); result.interventions += 1 } catch (error) { result.errors.push(`Intervento ${intervention.code || intervention.id}: ${error.message}`) }
  }
  return result
}
