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
