// E2E link di stato (Playwright): "Avvisa cliente" dalla scheda, testo WhatsApp, pagina pubblica su telefono.
// Richiede il server su :4001 con i dati di tests/e2e-seed.mjs (meglio dopo tests/e2e-rapportino.mjs).
import { chromium } from 'playwright'
const base = 'http://localhost:4001'
const out = process.env.SHOTS_DIR || 'e2e-shots'
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'it-IT', timezoneId: 'Europe/Rome' })
const page = await ctx.newPage()
const problems = []
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`))
page.on('response', (res) => { if (res.status() >= 400 && res.url().includes('/api/')) problems.push(`[http ${res.status()}] ${res.url()}`) })
const popups = []
ctx.on('page', (p) => popups.push(p.url()))
await page.addInitScript(() => { window.open = (url) => { window.__opened = [...(window.__opened || []), url]; return null } })

await page.goto(base)
await page.getByLabel('Email').fill('admin@fixlab.it')
await page.getByLabel('Password').fill('password123')
await page.getByRole('button', { name: 'Accedi' }).click()
await page.getByText('Buongiorno').waitFor()
await page.goto(`${base}/#/riparazioni`)
await page.waitForLoadState('networkidle')
await page.getByText('Lavastoviglie industriale').first().click()
await page.getByRole('button', { name: 'Avvisa cliente' }).click()
const modal = page.getByRole('dialog', { name: 'Avvisa il cliente' })
await modal.getByLabel('Testo (modificabile)').waitFor()
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/40-avvisa-cliente.png` })
const message = await modal.getByLabel('Testo (modificabile)').inputValue()
const statusPath = await modal.locator('a[href*="/s/"]').getAttribute('href')
await modal.getByRole('button', { name: 'WhatsApp' }).click()
const opened = await page.evaluate(() => window.__opened || [])

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'it-IT', timezoneId: 'Europe/Rome' })
const mobile = await phone.newPage()
mobile.on('pageerror', (err) => problems.push(`[mobile pageerror] ${err.message}`))
await mobile.goto(statusPath)
await mobile.getByText(/rif\. INV-/).waitFor()
await mobile.waitForTimeout(500)
await mobile.screenshot({ path: `${out}/41-stato-cliente-telefono.png`, fullPage: true })
const cookies = await phone.cookies()
console.log(JSON.stringify({ message, statusPath, whatsapp: opened[0], customerCookies: cookies.length, problems }, null, 1))
await browser.close()
if (problems.length || !opened[0]?.startsWith('https://wa.me/39')) process.exit(1)
