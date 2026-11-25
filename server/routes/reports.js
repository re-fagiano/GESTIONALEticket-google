import { Router } from 'express'
import { asyncHandler, badRequest, notFound } from '../lib/errors.js'
import { num, str } from '../lib/format.js'
import { newId } from '../db.js'
import { mapIntervention } from './interventions.js'
import { buildReportPdf } from '../services/reportPdf.js'

export const SHOP_DEFAULTS = {
  name: '', address: '', phone: '', email: '', vatNumber: '', footer: '',
  hourlyRate: 40, callFee: 35, pricesIncludeVat: true, logoFileId: null,
}
const PAYMENTS = ['', 'contanti', 'carta', 'bonifico', 'da_fatturare', 'garanzia', 'gia_pagato']
const round2 = (value) => Math.round(value * 100) / 100

export const reportRoutes = ({ db, auth, settings, files, hooks = {} }) => {
  const router = Router()
  const writer = auth.requireRole('ADMIN', 'OPERATOR')

  const shopProfile = async () => ({ ...SHOP_DEFAULTS, ...((await settings.get('shop.profile')) || {}) })

  router.get('/shop-profile', asyncHandler(async (req, res) => res.json(await shopProfile())))

  router.put('/shop-profile', auth.requireRole('ADMIN'), asyncHandler(async (req, res) => {
    const body = req.body || {}
    const current = await shopProfile()
    const next = { ...current }
    for (const key of ['name', 'address', 'phone', 'email', 'vatNumber', 'footer']) if (body[key] !== undefined) next[key] = str(body[key]).slice(0, key === 'footer' ? 600 : 200)
    for (const key of ['hourlyRate', 'callFee']) if (body[key] !== undefined) next[key] = Math.max(0, round2(num(body[key], current[key])))
    if (body.pricesIncludeVat !== undefined) next.pricesIncludeVat = Boolean(body.pricesIncludeVat)
    if (body.logoFileId !== undefined) next.logoFileId = str(body.logoFileId) || null
    await settings.set('shop.profile', next)
    res.json(next)
  }))

  const nextNumber = async (client, year) => {
    const row = await client.one(
      `INSERT INTO "report_counters" ("year", "last") VALUES ($1, 1)
       ON CONFLICT ("year") DO UPDATE SET "last" = "report_counters"."last" + 1 RETURNING "last"`,
      [year],
    )
    return `R-${year}-${String(row.last).padStart(4, '0')}`
  }

  // Crea (o rifà) il rapportino: calcola i totali, genera il PDF, lo salva tra i file dell'intervento.
  router.post('/interventions/:id/report', writer, asyncHandler(async (req, res) => {
    const body = req.body || {}
    const id = req.params.id
    const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 60).map((line) => ({
      kind: ['labor', 'call', 'part', 'other'].includes(line?.kind) ? line.kind : 'other',
      description: str(line?.description).slice(0, 300),
      qty: round2(Math.max(0, num(line?.qty, 1))),
      unitPrice: round2(num(line?.unitPrice, 0)),
      ...(str(line?.itemId) ? { itemId: str(line.itemId) } : {}),
    })).filter((line) => line.description && line.qty > 0)
    const subtotal = round2(lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0))
    const discount = round2(Math.min(subtotal, Math.max(0, num(body.discount, 0))))
    const paymentMethod = str(body.paymentMethod)
    if (!PAYMENTS.includes(paymentMethod)) throw badRequest('Metodo di pagamento non valido.')
    const workDone = str(body.workDone).slice(0, 4000)
    if (!workDone) throw badRequest('Descrivi il lavoro svolto.', 'work_done_required')
    const signatureFileId = str(body.signatureFileId) || null
    const signerName = str(body.signerName).slice(0, 120)
    if (signatureFileId && !signerName) throw badRequest('Indica il nome di chi firma.', 'signer_required')

    const shop = await shopProfile()
    const signature = signatureFileId ? await files.get(signatureFileId) : null
    if (signatureFileId && (!signature || signature.mimeType !== 'image/png')) throw badRequest('Firma non valida.', 'signature_invalid')
    const logo = shop.logoFileId ? await files.get(shop.logoFileId) : null

    const result = await db.tx(async (client) => {
      const row = await client.one('SELECT * FROM "interventions" WHERE "id" = $1 FOR UPDATE', [id])
      if (!row) throw notFound('Intervento non trovato.')
      const customer = await client.one('SELECT * FROM "customers" WHERE "id" = $1', [row.customerId])
      const previous = row.additionalData?.report || null
      const now = new Date()
      const report = {
        number: previous?.number || await nextNumber(client, Number(now.toLocaleString('en-US', { timeZone: 'Europe/Rome', year: 'numeric' }))),
        workDone,
        notes: str(body.notes).slice(0, 1000),
        lines,
        subtotal,
        discount,
        total: round2(subtotal - discount),
        paymentMethod,
        signerName,
        signatureFileId,
        signedAt: signatureFileId ? now.toISOString() : null,
        technician: str(req.user.email).split('@')[0],
        createdAt: previous?.createdAt || now.toISOString(),
        updatedAt: now.toISOString(),
        createdBy: req.user.id,
      }
      const pdf = await buildReportPdf({ shop, report, intervention: mapIntervention(row), customer, signaturePng: signature?.data || null, logo })
      const saved = await files.save({ buffer: pdf, fileName: `Rapportino ${report.number}.pdf`, mimeType: 'application/pdf', kind: 'report', interventionId: id, uploadedBy: req.user.id }, client)
      report.pdfFileId = saved.id
      report.pdfSize = saved.size
      if (previous?.pdfFileId) report.previousPdfFileIds = [...(previous.previousPdfFileIds || []), previous.pdfFileId].slice(-10)

      const additionalData = { ...(row.additionalData || {}), report }
      const close = Boolean(body.closeIntervention) && row.status !== 'completato'
      await client.query(
        `UPDATE "interventions" SET "additionalData" = $2, "version" = "version" + 1, "updatedAt" = NOW()
           ${close ? `, "status" = 'completato', "closedAt" = COALESCE("closedAt", NOW())` : ''}
         WHERE "id" = $1`,
        [id, additionalData],
      )
      const log = (action, note) => client.query('INSERT INTO "intervento_logs" ("id", "interventoId", "userId", "action", "note", "createdAt") VALUES ($1, $2, $3, $4, $5, NOW())', [newId(), id, req.user.id, action, note])
      await log(previous ? 'rapportino_aggiornato' : 'rapportino_creato', `${report.number} · totale ${report.total.toFixed(2)} €${signerName ? ` · firmato da ${signerName}` : ''}`)
      if (close) await log('status_changed', 'Nuovo stato: completato')
      return report
    })

    Promise.resolve(hooks.onChange?.('upsert', id)).catch(() => {})
    const row = await db.one('SELECT * FROM "interventions" WHERE "id" = $1', [id])
    const logs = await db.query('SELECT * FROM "intervento_logs" WHERE "interventoId" = $1 ORDER BY "createdAt"', [id])
    res.status(201).json({ report: result, intervention: mapIntervention(row, logs) })
  }))

  return router
}
