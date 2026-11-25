// Percorso end-to-end con Playwright usato per verificare l'interfaccia v2 (non fa parte di `pnpm test`).
// Richiede un server avviato su :4001 con dati di prova (vedi tests/e2e-seed.mjs).
import { chromium } from 'playwright'
const base = 'http://localhost:4001'
const out = process.env.SHOTS_DIR || 'e2e-shots'
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'it-IT', timezoneId: 'Europe/Rome' })
const problems = []
page.on('console', (msg) => { if (['error', 'warning'].includes(msg.type())) problems.push(`[console.${msg.type()}] ${msg.text()}`) })
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`))
page.on('response', (res) => { if (res.status() >= 400 && res.url().includes('/api/')) problems.push(`[http ${res.status()}] ${res.request().method()} ${res.url()}`) })
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }) }

await page.goto(base)
await page.getByLabel('Email').fill('admin@fixlab.it')
await page.getByLabel('Password').fill('password123')
await page.getByRole('button', { name: 'Accedi' }).click()
await page.getByText('Buongiorno').waitFor()
await shot('01-dashboard')

for (const [hash, name] of [['clienti', '02-clienti'], ['chiamate', '03-chiamate'], ['riparazioni', '04-riparazioni'], ['ordini', '05-ordini'], ['preventivi', '06-preventivi'], ['magazzino', '07-magazzino'], ['calendario', '08-calendario'], ['impostazioni?tab=backup', '09-backup'], ['impostazioni?tab=utenti', '10-utenti']]) {
  await page.goto(`${base}/#/${hash}`)
  await page.waitForLoadState('networkidle')
  await shot(name)
}

// Magazzino: ricerca + apertura scheda con Invio + scarico
await page.goto(`${base}/#/magazzino`)
await page.waitForLoadState('networkidle')
await page.getByLabel('Cerca nel magazzino').fill('00611332')
await page.waitForTimeout(400)
await page.getByLabel('Cerca nel magazzino').press('Enter')
await page.getByRole('dialog').waitFor()
await shot('11-magazzino-scheda')
await page.getByRole('dialog').getByLabel('Quantità').fill('2')
await page.getByRole('dialog').getByRole('button', { name: 'Registra scarico' }).click()
await page.getByText('Scaricati 2 pz').waitFor()
await shot('12-magazzino-dopo-scarico')
await page.keyboard.press('Escape')

// Import con anteprima
await page.getByRole('button', { name: 'Importa file' }).click()
await page.setInputFiles('input[type=file]', { name: 'arrivo.csv', mimeType: 'text/csv', buffer: Buffer.from('CODICE;DESCRIZIONE;QUANTITA\nBSH-00145;Pompa scarico lavastoviglie Bosch;3\nNEW-1;Cinghia lavatrice;2\n;;\n') })
await page.getByText('Anteprima: niente è stato ancora salvato').waitFor()
await shot('13-import-anteprima')
await page.getByRole('button', { name: 'Conferma import' }).click()
await page.getByText('Import completato').waitFor()

// Nuova chiamata con cliente nuovo creato al volo
await page.goto(`${base}/#/chiamate`)
await page.getByRole('button', { name: 'Nuova chiamata' }).first().click()
await page.getByLabel('Cerca cliente').fill('Neri Paolo')
await page.getByRole('button', { name: 'Nuovo cliente' }).click()
await page.getByPlaceholder('Telefono').fill('333 0000000')
await page.getByRole('button', { name: 'Salva cliente' }).click()
await page.getByText('Cliente creato').waitFor()
await page.getByLabel('Descrizione del problema / richiesta').fill('Asciugatrice non parte, display spento')
await shot('14-nuova-chiamata')
await page.getByRole('button', { name: 'Salva chiamata' }).click()
await page.getByText(/Chiamata INV-.* creata/).waitFor()
await page.getByRole('dialog').waitFor()
await shot('15-dettaglio-chiamata')
// nota + scarico ricambio collegato
await page.getByPlaceholder('Aggiungi una nota').fill('Sostituito fusibile, ok')
await page.getByRole('button', { name: 'Salva aggiornamento' }).click()
await page.getByText('Aggiornamento salvato').waitFor()
await page.getByLabel('Cerca ricambio').fill('filtro')
await page.getByRole('button', { name: /FIL-ANTICAL/ }).click()
await page.getByText('Scaricato FIL-ANTICAL').waitFor()
await shot('16-chiamata-con-nota-e-ricambio')
await page.getByRole('button', { name: 'Porta in laboratorio (riparazione)' }).click()
await page.getByText(/Creata riparazione/).waitFor()
await shot('17-riparazione-creata')

// Mobile
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${base}/#/magazzino`)
await page.waitForLoadState('networkidle')
await shot('18-mobile-magazzino')
await page.goto(`${base}/#/dashboard`)
await page.waitForLoadState('networkidle')
await shot('19-mobile-dashboard')

console.log(problems.length ? problems.join('\n') : 'NESSUN ERRORE CONSOLE/HTTP')
await browser.close()
