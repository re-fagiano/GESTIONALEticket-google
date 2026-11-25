// Vocabolario condiviso del gestionale: tipi di intervento, stati, urgenze, causali di magazzino.

export const INTERVENTION_TYPES = {
  chiamata: { label: 'Chiamate', singular: 'Chiamata', route: 'chiamate', color: 'bg-sky-100 text-sky-800' },
  riparazione: { label: 'Riparazioni', singular: 'Riparazione', route: 'riparazioni', color: 'bg-violet-100 text-violet-800' },
  ordine_ricambi: { label: 'Ordini ricambi', singular: 'Ordine ricambi', route: 'ordini', color: 'bg-amber-100 text-amber-800' },
  preventivo: { label: 'Preventivi nuovi', singular: 'Preventivo', route: 'preventivi', color: 'bg-emerald-100 text-emerald-800' },
}

export const STATUSES = {
  pendente: { label: 'Da fare', color: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  in_lavorazione: { label: 'In lavorazione', color: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
  completato: { label: 'Completato', color: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  annullato: { label: 'Annullato', color: 'bg-red-100 text-red-700', dot: 'bg-red-400' },
}

export const URGENCY = {
  1: { label: 'Bassa', color: 'text-slate-500' },
  2: { label: 'Media', color: 'text-amber-600' },
  3: { label: 'Alta', color: 'text-red-600 font-semibold' },
}

export const MOVEMENT_REASONS = {
  carico: 'Carico',
  scarico: 'Scarico',
  intervento: 'Usato in intervento',
  reso: 'Reso',
  rettifica: 'Rettifica',
  inventario: 'Inventario',
  import: 'Import file',
}

export const ROLES = { ADMIN: 'Amministratore', OPERATOR: 'Operatore', VIEWER: 'Sola lettura' }

export const isOpen = (intervention) => !['completato', 'annullato'].includes(intervention?.status)

// Note/descrizioni a voci (formato già usato dalla vecchia interfaccia in additionalData.descriptionEntries).
export const descriptionEntries = (intervention) => {
  const entries = intervention?.additionalData?.descriptionEntries
  if (Array.isArray(entries) && entries.length) return entries
  return intervention?.description ? [{ id: 'original', text: intervention.description, source: 'original', createdAt: intervention.openedAt }] : []
}

export const attachmentsOf = (intervention) => {
  const data = intervention?.additionalData || {}
  const list = Array.isArray(data.attachments) ? data.attachments : (Array.isArray(data.files) ? data.files : [])
  return list.filter((item) => item && typeof item.dataUrl === 'string' && item.dataUrl)
}

// Colori degli eventi di Google Calendar (id → tinta mostrata da Google).
export const GOOGLE_EVENT_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
}

// Testo leggibile (bianco o nero) sopra un colore di sfondo.
export const textOn = (hex = '#000000') => {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1e293b' : '#ffffff'
}
