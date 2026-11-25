// E2E allegati (Playwright): foto grande compressa nel browser, caricata a parte e mostrata nella scheda.
// Richiede il server su :4001 con i dati di tests/e2e-seed.mjs e una foto in FOTO (default /tmp/foto.jpg, una foto da telefono di alcuni MB).
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
const base = 'http://localhost:4001'
const out = process.env.SHOTS_DIR || 'e2e-shots'
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'it-IT' })
const problems = []
const uploads = []
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`))
page.on('response', (res) => { if (res.url().includes('/api/files') && res.status() === 201) uploads.push(res.url().split('?')[1]) ; if (res.status() >= 400 && res.url().includes('/api/')) problems.push(`[http ${res.status()}] ${res.url()}`) })

await page.goto(base)
await page.getByLabel('Email').fill('admin@fixlab.it')
await page.getByLabel('Password').fill('password123')
await page.getByRole('button', { name: 'Accedi' }).click()
await page.getByText('Buongiorno').waitFor()
await page.goto(`${base}/#/riparazioni`)
await page.waitForLoadState('networkidle')
await page.getByText('Lavastoviglie industriale').first().click()
const drawer = page.getByRole('dialog')
await drawer.waitFor()
await drawer.locator('input[type=file]').setInputFiles({ name: 'targhetta.jpg', mimeType: 'image/jpeg', buffer: readFileSync(process.env.FOTO || '/tmp/foto.jpg') })
await drawer.getByRole('button', { name: 'Salva aggiornamento' }).click()
await page.getByText('Aggiornamento salvato.').waitFor()
const img = drawer.locator('img[alt="targhetta.jpg"]').last()
await img.waitFor()
const loaded = await img.evaluate((el) => el.complete && el.naturalWidth)
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/20-allegato.png` })
console.log(JSON.stringify({ uploads, naturalWidth: loaded, src: await img.getAttribute('src'), problems }, null, 1))
await browser.close()
if (problems.length || !loaded || !uploads.length) process.exit(1)
