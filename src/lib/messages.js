// Messaggi al cliente: testi pronti (modificabili prima dell'invio) e link per WhatsApp, email, SMS.
// L'invio parte dal telefono/PC del negozio: nessun servizio a pagamento e nessun numero "finto".

// Numero italiano in formato internazionale senza "+" (quello che vuole wa.me).
export const normalizePhone = (value) => {
  let digits = String(value || '').replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (/^(3\d{8,9}|0\d{5,10})$/.test(digits)) digits = `39${digits}`
  return /^\d{8,15}$/.test(digits) ? digits : ''
}
export const isMobile = (value) => /^393\d{8,9}$/.test(normalizePhone(value))

export const whatsappUrl = (phone, text) => `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`
export const smsUrl = (phone, text) => `sms:+${normalizePhone(phone)}?&body=${encodeURIComponent(text)}`
export const mailtoUrl = (email, subject, text) => `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`

const day = (value) => new Date(value).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' })
const time = (value) => new Date(value).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
const euro = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0)

export const TEMPLATES = {
  appuntamento: { label: 'Conferma appuntamento', types: ['chiamata'] },
  ricevuto: { label: 'Apparecchio ricevuto', types: ['riparazione'] },
  pronto: { label: 'Pronto per il ritiro', types: ['riparazione'] },
  completato: { label: 'Intervento completato', types: ['chiamata'] },
  ricambio: { label: 'Ricambio arrivato', types: ['ordine_ricambi'] },
  preventivo: { label: 'Preventivo pronto', types: ['preventivo'] },
  stato: { label: 'Link allo stato', types: ['chiamata', 'riparazione', 'ordine_ricambi', 'preventivo'] },
}

export const suggestedTemplate = (item) => {
  const data = item.additionalData || {}
  if (item.type === 'chiamata') return item.status === 'completato' ? 'completato' : 'appuntamento'
  if (item.type === 'riparazione') return item.status === 'completato' ? 'pronto' : 'ricevuto'
  if (item.type === 'ordine_ricambi') return ['arrivato', 'consegnato'].includes(data.orderStatus) || item.status === 'completato' ? 'ricambio' : 'stato'
  if (item.type === 'preventivo') return 'preventivo'
  return 'stato'
}

export const buildMessage = (template, { item, customer, shop, link }) => {
  const data = item.additionalData || {}
  const appliance = [data.applianceBrand, data.applianceModel].filter(Boolean).join(' ')
  const thing = appliance ? `il suo ${appliance}` : "l'apparecchio"
  const hello = customer?.name ? `Buongiorno ${customer.name},` : 'Buongiorno,'
  const sign = [shop?.name, shop?.phone].filter(Boolean).join(' · ')
  const report = data.report
  const linkLine = link ? `\nStato aggiornato: ${link}` : ''
  const body = {
    appuntamento: `${hello} le confermiamo l'intervento del nostro tecnico${appliance ? ` per ${appliance}` : ''} ${day(item.openedAt)} alle ${time(item.openedAt)} circa.${linkLine}\nPer spostare l'appuntamento risponda pure a questo messaggio.`,
    ricevuto: `${hello} abbiamo ricevuto in laboratorio ${thing} (rif. ${item.code}). La avviseremo appena sarà pronto.${linkLine}`,
    pronto: `${hello} ${thing} è pronto per il ritiro (rif. ${item.code}).${report ? ` Importo: ${euro(report.total)}.` : ''}${shop?.address ? `\nCi trova in ${shop.address}.` : ''}${linkLine}`,
    completato: `${hello} grazie per averci scelto. ${report ? `Qui trova il rapportino dell'intervento n. ${report.number}` : 'Qui trova il riepilogo dell\'intervento'}:${link ? ` ${link}` : ''}`,
    ricambio: `${hello} il ricambio che aveva ordinato${data.sparePartCode ? ` (${data.sparePartCode})` : ''} è arrivato in negozio: può passare a ritirarlo.${linkLine}`,
    preventivo: `${hello} il preventivo che ci aveva chiesto è pronto${Number(data.quoteTotal) ? `: ${euro(data.quoteTotal)}` : ''}.${data.quoteItems ? `\n${data.quoteItems}` : ''}${linkLine}\nRestiamo a disposizione per qualsiasi domanda.`,
    stato: `${hello} può seguire lo stato della sua pratica (rif. ${item.code}) qui: ${link || ''}`,
  }[template] || ''
  return sign ? `${body}\n\n${sign}` : body
}

export const subjectFor = (template, { item, shop }) => `${TEMPLATES[template]?.label || 'Aggiornamento'} · rif. ${item.code}${shop?.name ? ` · ${shop.name}` : ''}`
