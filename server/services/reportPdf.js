import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// Rapportino d'intervento in PDF (A4), generato sul server: stesso aspetto su ogni telefono
// e copia conservata insieme all'intervento.

const A4 = [595.28, 841.89]
const MARGIN = 42
const INK = rgb(0.1, 0.12, 0.16)
const MUTED = rgb(0.42, 0.45, 0.5)
const LINE = rgb(0.85, 0.87, 0.9)
const ACCENT = rgb(0.85, 0.55, 0.05)

export const euro = (value) => `€ ${(Math.round(Number(value || 0) * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateIt = (value) => (value ? new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

const TYPE_LABEL = { chiamata: 'Intervento a domicilio', riparazione: 'Riparazione in laboratorio', ordine_ricambi: 'Ordine ricambi', preventivo: 'Preventivo' }
const PAYMENT_LABEL = { contanti: 'Contanti', carta: 'Carta / bancomat', bonifico: 'Bonifico', da_fatturare: 'Da fatturare', garanzia: 'In garanzia', gia_pagato: 'Già pagato' }

export const buildReportPdf = async ({ shop = {}, report, intervention, customer, signaturePng = null, logo = null }) => {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Rapportino ${report.number}`)
  pdf.setAuthor(shop.name || 'FixLab')
  pdf.setCreator('FixLab')
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // I font standard PDF coprono solo l'alfabeto WinAnsi: sostituiamo i caratteri non stampabili (emoji ecc.).
  const encodable = new Map()
  const safe = (text) => [...String(text ?? '').replace(/\r/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')].map((ch) => {
    if (ch === '\n') return ch
    if (!encodable.has(ch)) { try { regular.encodeText(ch); encodable.set(ch, true) } catch { encodable.set(ch, false) } }
    return encodable.get(ch) ? ch : '?'
  }).join('')

  let page = pdf.addPage(A4)
  const width = A4[0] - MARGIN * 2
  let y = A4[1] - MARGIN

  const newPageIfNeeded = (needed) => {
    if (y - needed > MARGIN + 20) return
    page = pdf.addPage(A4)
    y = A4[1] - MARGIN
  }
  const wrap = (text, font, size, maxWidth) => {
    const lines = []
    for (const paragraph of safe(text).split('\n')) {
      let line = ''
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue }
        if (line) lines.push(line)
        line = word
        while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut -= 1
          lines.push(line.slice(0, cut))
          line = line.slice(cut)
        }
      }
      lines.push(line)
    }
    return lines
  }
  const text = (value, x, yy, { font = regular, size = 10, color = INK } = {}) => page.drawText(safe(value), { x, y: yy, font, size, color })
  const paragraph = (value, { font = regular, size = 10, color = INK, x = MARGIN, maxWidth = width, gap = 3 } = {}) => {
    for (const line of wrap(value, font, size, maxWidth)) {
      newPageIfNeeded(size + gap)
      y -= size + gap
      text(line, x, y, { font, size, color })
    }
  }
  const rightText = (value, xRight, yy, opts = {}) => {
    const font = opts.font || regular
    const size = opts.size || 10
    text(value, xRight - font.widthOfTextAtSize(safe(value), size), yy, opts)
  }
  const heading = (label) => {
    newPageIfNeeded(40)
    y -= 22
    text(label.toUpperCase(), MARGIN, y, { font: bold, size: 9, color: MUTED })
    y -= 6
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.7, color: LINE })
  }

  // Intestazione: logo e dati del negozio a sinistra, numero e data a destra.
  let headerBottom = y
  let textX = MARGIN
  if (logo) {
    try {
      const image = logo.mimeType === 'image/png' ? await pdf.embedPng(logo.data) : await pdf.embedJpg(logo.data)
      const scale = Math.min(110 / image.width, 48 / image.height)
      page.drawImage(image, { x: MARGIN, y: y - image.height * scale, width: image.width * scale, height: image.height * scale })
      textX = MARGIN + image.width * scale + 12
      headerBottom = Math.min(headerBottom, y - image.height * scale)
    } catch { /* logo non leggibile: lo saltiamo */ }
  }
  let hy = y - 14
  text(shop.name || 'FixLab', textX, hy, { font: bold, size: 15 })
  for (const line of [shop.address, [shop.phone, shop.email].filter(Boolean).join(' · '), shop.vatNumber ? `P.IVA ${shop.vatNumber}` : ''].filter(Boolean)) {
    hy -= 12
    text(line, textX, hy, { size: 9, color: MUTED })
  }
  headerBottom = Math.min(headerBottom, hy)
  rightText('RAPPORTINO DI INTERVENTO', MARGIN + width, y - 12, { font: bold, size: 11, color: ACCENT })
  rightText(`N. ${report.number}`, MARGIN + width, y - 27, { font: bold, size: 12 })
  rightText(dateIt(report.signedAt || report.createdAt), MARGIN + width, y - 41, { size: 9, color: MUTED })
  rightText(`Rif. ${intervention.code}`, MARGIN + width, y - 53, { size: 9, color: MUTED })
  y = Math.min(headerBottom, y - 53) - 8

  // Cliente e apparecchio, su due colonne.
  heading('Cliente e apparecchio')
  const colW = width / 2 - 10
  const left = [customer?.name, customer?.address, customer?.phone, customer?.email].filter(Boolean)
  const data = intervention.additionalData || {}
  const right = [
    TYPE_LABEL[intervention.type] || intervention.type,
    [data.applianceBrand, data.applianceModel].filter(Boolean).join(' '),
    data.serialNumber ? `Matricola: ${data.serialNumber}` : '',
    data.defect ? `Difetto: ${data.defect}` : '',
  ].filter(Boolean)
  const startY = y
  let ly = startY
  left.forEach((line, i) => { for (const l of wrap(line, i === 0 ? bold : regular, 10, colW)) { ly -= 13; text(l, MARGIN, ly, { font: i === 0 ? bold : regular }) } })
  let ry = startY
  right.forEach((line, i) => { for (const l of wrap(line, i === 0 ? bold : regular, 10, colW)) { ry -= 13; text(l, MARGIN + width / 2 + 10, ry, { font: i === 0 ? bold : regular }) } })
  y = Math.min(ly, ry)

  heading('Lavoro svolto')
  y -= 4
  paragraph(report.workDone || '—', { size: 10, gap: 4 })
  if (report.notes) { y -= 4; paragraph(`Note: ${report.notes}`, { size: 9, color: MUTED }) }

  // Voci e totale.
  heading('Dettaglio')
  const cols = { desc: MARGIN, qty: MARGIN + width - 190, unit: MARGIN + width - 95, total: MARGIN + width }
  y -= 14
  text('Descrizione', cols.desc, y, { font: bold, size: 9, color: MUTED })
  rightText('Q.tà', cols.qty + 30, y, { font: bold, size: 9, color: MUTED })
  rightText('Prezzo', cols.unit + 30, y, { font: bold, size: 9, color: MUTED })
  rightText('Importo', cols.total, y, { font: bold, size: 9, color: MUTED })
  for (const line of report.lines || []) {
    const descLines = wrap(line.description, regular, 10, cols.qty - cols.desc - 20)
    newPageIfNeeded(descLines.length * 13 + 6)
    y -= 15
    descLines.forEach((l, i) => text(l, cols.desc, y - i * 13))
    rightText(String(line.qty), cols.qty + 30, y)
    rightText(euro(line.unitPrice), cols.unit + 30, y)
    rightText(euro(line.qty * line.unitPrice), cols.total, y)
    y -= (descLines.length - 1) * 13
  }
  if (!(report.lines || []).length) { y -= 15; text('Nessun addebito.', cols.desc, y, { color: MUTED }) }
  y -= 10
  page.drawLine({ start: { x: MARGIN + width - 200, y }, end: { x: MARGIN + width, y }, thickness: 0.7, color: LINE })
  if (report.discount) {
    y -= 15
    rightText('Sconto', cols.unit + 30, y, { color: MUTED })
    rightText(`- ${euro(report.discount)}`, cols.total, y)
  }
  y -= 18
  rightText('TOTALE', cols.unit + 30, y, { font: bold, size: 12 })
  rightText(euro(report.total), cols.total, y, { font: bold, size: 12 })
  y -= 13
  rightText(shop.pricesIncludeVat === false ? 'IVA esclusa' : 'IVA inclusa', cols.total, y, { size: 8, color: MUTED })
  if (report.paymentMethod) {
    y -= 12
    rightText(`Pagamento: ${PAYMENT_LABEL[report.paymentMethod] || report.paymentMethod}`, cols.total, y, { size: 9 })
  }

  // Firma.
  newPageIfNeeded(130)
  heading('Firma del cliente')
  y -= 8
  const boxH = 80
  page.drawRectangle({ x: MARGIN, y: y - boxH, width: 240, height: boxH, borderColor: LINE, borderWidth: 0.7 })
  if (signaturePng) {
    const image = await pdf.embedPng(signaturePng)
    const scale = Math.min(230 / image.width, (boxH - 10) / image.height)
    page.drawImage(image, { x: MARGIN + 5, y: y - boxH + 5, width: image.width * scale, height: image.height * scale })
  }
  const sy = y
  text(report.signerName ? `Firmato da: ${report.signerName}` : 'Firma non raccolta', MARGIN + 260, sy - 14, { font: bold })
  if (report.signedAt) text(dateIt(report.signedAt), MARGIN + 260, sy - 28, { size: 9, color: MUTED })
  if (report.technician) text(`Tecnico: ${report.technician}`, MARGIN + 260, sy - 42, { size: 9, color: MUTED })
  y -= boxH + 4
  for (const line of wrap('Il cliente dichiara che l\'intervento è stato eseguito come descritto e che l\'apparecchio è stato verificato in sua presenza.', regular, 8, width)) { y -= 10; text(line, MARGIN, y, { size: 8, color: MUTED }) }

  // Piè di pagina su ogni pagina.
  const footer = safe(shop.footer || 'Documento non fiscale. La garanzia sulla riparazione copre i ricambi sostituiti e la manodopera secondo le norme vigenti.')
  pdf.getPages().forEach((p, index, all) => {
    let fy = MARGIN - 10
    for (const line of wrap(footer, regular, 7.5, width - 60).reverse()) { p.drawText(line, { x: MARGIN, y: fy, font: regular, size: 7.5, color: MUTED }); fy += 9 }
    const label = `${index + 1}/${all.length}`
    p.drawText(label, { x: MARGIN + width - regular.widthOfTextAtSize(label, 7.5), y: MARGIN - 10, font: regular, size: 7.5, color: MUTED })
  })

  return Buffer.from(await pdf.save())
}
