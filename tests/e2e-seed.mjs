// Popola il database e2e con dati realistici tramite l'API.
const base = 'http://localhost:4001'
let cookies = {}
const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': decodeURIComponent(cookies.csrf_token || '') },
    body: body ? JSON.stringify(body) : undefined,
  })
  for (const c of res.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); cookies[p.slice(0, i)] = p.slice(i + 1) }
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
await call('POST', '/api/auth/login', { email: 'admin@fixlab.it', password: 'password123' })
const names = [['Rossi Maria', '333 1234567', 'Via Roma 12, Pesaro'], ['Bianchi Luca', '339 7654321', 'Viale della Repubblica 4, Pesaro'], ['Hotel Mare Blu', '0721 123456', 'Lungomare Nazario Sauro 30, Pesaro'], ['Verdi Anna', '347 1112223', 'Via Mazzini 8, Fano']]
const customers = []
for (const [name, phone, address] of names) customers.push(await call('POST', '/api/customers', { name, phone, address }))
const now = new Date()
const at = (days, hour) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString() }
await call('POST', '/api/interventions', { clientId: customers[0].id, type: 'chiamata', urgency: 3, openedAt: at(0, 10), description: 'Lavatrice Bosch non scarica, errore E18', additionalData: { applianceBrand: 'Bosch', applianceModel: 'WAN28', defect: 'Non scarica' } })
await call('POST', '/api/interventions', { clientId: customers[1].id, type: 'chiamata', urgency: 2, openedAt: at(0, 15), description: 'Frigo non raffredda' })
await call('POST', '/api/interventions', { clientId: customers[2].id, type: 'riparazione', urgency: 2, openedAt: at(-2, 9), description: 'Lavastoviglie industriale: pompa rumorosa', additionalData: { applianceBrand: 'Electrolux', serialNumber: 'SN-99812' } })
await call('POST', '/api/interventions', { clientId: customers[3].id, type: 'ordine_ricambi', urgency: 1, openedAt: at(-1, 11), description: 'Guarnizione oblò', additionalData: { sparePartCode: 'WHI-481246668775', quantity: 1, supplier: 'Ricambi Adriatica', orderStatus: 'ordinato' } })
await call('POST', '/api/interventions', { clientId: customers[0].id, type: 'preventivo', urgency: 2, openedAt: at(1, 17), description: 'Nuova lavasciuga', additionalData: { quoteItems: 'Samsung WD90 / LG F4DV', quoteTotal: 899, quoteStatus: 'proposto' } })
const csv = 'POSIZIONE;CODICE;DESCRIZIONE;PREZZO AL PUBBLICO;QUANTITA;SCORTA MINIMA;CODICI ALTERNATIVI\nA-01;BSH-00145;Pompa scarico lavastoviglie Bosch;32,50;4;2;00611332\nA-02;WHI-481246668775;Guarnizione oblò Whirlpool;45,00;1;2;\nB-01;ELX-140000;Resistenza lavatrice 2000W;28,90;0;1;\nB-02;UNI-TERM-01;Termostato frigo universale;19,00;7;2;RANCO K59\nC-01;FIL-ANTICAL;Filtro anticalcare;5,00;25;5;\n'
console.log(await call('POST', '/api/inventory/import', { csv, mode: 'add' }))
await call('POST', '/api/tickets', { id: 'legacy-ticket-1', subject: 'Forno non scalda (ticket vecchio)', customerId: customers[1].id, date: '2026-11-20' })
console.log('seed ok')
