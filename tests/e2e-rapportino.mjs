// E2E rapportino (Playwright): dati negozio, firma col "dito" su una chiamata, PDF generato.
// Richiede il server su :4001 con i dati di tests/e2e-seed.mjs.
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
const base = 'http://localhost:4001'
const out = process.env.SHOTS_DIR || 'e2e-shots'
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'it-IT', timezoneId: 'Europe/Rome' })
const problems = []
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`))
page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`[console] ${msg.text()}`) })
page.on('response', (res) => { if (res.status() >= 400 && res.url().includes('/api/')) problems.push(`[http ${res.status()}] ${res.url()}`) })

await page.goto(base)
await page.getByLabel('Email').fill('admin@fixlab.it')
await page.getByLabel('Password').fill('password123')
await page.getByRole('button', { name: 'Accedi' }).click()
await page.getByText('Buongiorno').waitFor()

await page.goto(`${base}/#/impostazioni?tab=negozio`)
await page.getByLabel('Nome del negozio').fill('Elettrodomestici Pesaro')
await page.getByLabel('Indirizzo').fill('Via dei Canonici 12, 61121 Pesaro (PU)')
await page.getByLabel('Telefono').fill('0721 000000')
await page.getByLabel('Partita IVA').fill('01234567890')
await page.getByRole('button', { name: 'Salva' }).click()
await page.getByText('Dati del negozio salvati.').waitFor()
await page.screenshot({ path: `${out}/30-negozio.png` })

await page.goto(`${base}/#/chiamate`)
await page.waitForLoadState('networkidle')
await page.getByText('Lavatrice Bosch non scarica').first().click()
await page.getByRole('button', { name: 'Crea rapportino con firma del cliente' }).click()
const modal = page.getByRole('dialog', { name: 'Nuovo rapportino' })
await modal.waitFor()
await modal.getByLabel('Lavoro svolto').fill('Pulito filtro pompa di scarico (ostruito da una moneta), verificato tubo di scarico, provato ciclo risciacquo e centrifuga: scarica regolarmente.')
await modal.getByLabel('Pagamento').selectOption('contanti')
const pad = await modal.getByLabel('Riquadro firma del cliente').boundingBox()
await page.mouse.move(pad.x + 40, pad.y + 120)
await page.mouse.down()
for (let i = 0; i <= 40; i += 1) await page.mouse.move(pad.x + 40 + i * 8, pad.y + 100 + Math.sin(i / 3) * 40, { steps: 2 })
await page.mouse.up()
await page.screenshot({ path: `${out}/31-rapportino-firma.png` })
await modal.getByRole('button', { name: 'Salva e crea PDF' }).click()
await page.getByText(/Rapportino R-\d{4}-\d{4} salvato/).waitFor()
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/32-rapportino-salvato.png` })
const href = await page.getByRole('link', { name: 'Apri PDF' }).getAttribute('href')
const pdf = await page.request.get(`${base}${href}`)
writeFileSync(`${out}/rapportino.pdf`, await pdf.body())
console.log(JSON.stringify({ pdf: pdf.headers()['content-type'], bytes: (await pdf.body()).length, problems }, null, 1))
await browser.close()
if (problems.length) process.exit(1)
