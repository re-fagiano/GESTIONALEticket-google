import { useEffect, useMemo, useState } from 'react'
import { Bot, CalendarDays, Download, ExternalLink, FileText, MapPin, Package, Paperclip, Phone, Plus, Search, Trash2, Wrench } from 'lucide-react'
import { api, qs, request } from '../lib/api'
import { useAuth } from '../lib/auth'
import { INTERVENTION_TYPES, MOVEMENT_REASONS, STATUSES, URGENCY, attachmentsOf, descriptionEntries, isOpen } from '../lib/domain'
import { fileSize, fmtDate, fmtDateTime, fmtEuro, fromLocalInput, newId, relativeDays, toLocalInput } from '../lib/format'
import { navigate, useAsync, useShared } from '../lib/hooks'
import CustomerPicker from '../components/CustomerPicker'
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Modal, Pagination, Select, Spinner, Stat, Tabs, Textarea, cx, useDebounced, useToast } from '../components/ui'

const PAGE_SIZE = 25
const MAX_ATTACHMENT_MB = 8

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error(`Impossibile leggere ${file.name}`))
  reader.readAsDataURL(file)
})

const toAttachments = async (files, operator) => {
  const tooBig = files.find((file) => file.size > MAX_ATTACHMENT_MB * 1024 * 1024)
  if (tooBig) throw new Error(`${tooBig.name} supera ${MAX_ATTACHMENT_MB} MB.`)
  return Promise.all(files.map(async (file) => ({
    id: newId(), fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size,
    uploadedAt: new Date().toISOString(), uploadedBy: operator, dataUrl: await readAsDataUrl(file),
  })))
}

// Campi specifici per tipo (stessi nomi usati dalla vecchia interfaccia in additionalData).
const TYPE_FIELDS = {
  riparazione: [['applianceBrand', 'Marca'], ['applianceModel', 'Modello'], ['serialNumber', 'Matricola / seriale'], ['defect', 'Difetto riscontrato']],
  chiamata: [['applianceBrand', 'Marca'], ['applianceModel', 'Modello'], ['defect', 'Difetto segnalato']],
  ordine_ricambi: [['sparePartCode', 'Codice ricambio'], ['quantity', 'Quantità', 'number'], ['supplier', 'Fornitore'], ['orderStatus', 'Stato ordine', 'select', { ordinato: 'Ordinato', in_arrivo: 'In arrivo', arrivato: 'Arrivato', consegnato: 'Consegnato al cliente' }]],
  preventivo: [['quoteItems', 'Modelli / prodotti proposti', 'textarea'], ['quoteTotal', 'Importo (€)', 'number'], ['quoteValidUntil', 'Valido fino al', 'date'], ['quoteStatus', 'Esito', 'select', { proposto: 'Proposto', accettato: 'Accettato', rifiutato: 'Rifiutato' }]],
}

function TypeFields({ type, data, onChange, disabled }) {
  const fields = TYPE_FIELDS[type] || []
  if (!fields.length) return null
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(([key, label, kind, options]) => {
        const common = { label, value: data?.[key] ?? '', disabled, onChange: (e) => onChange({ ...data, [key]: e.target.value }) }
        if (kind === 'textarea') return <Textarea key={key} className="sm:col-span-2" {...common} />
        if (kind === 'select') return <Select key={key} {...common}><option value="">—</option>{Object.entries(options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        return <Input key={key} type={kind || 'text'} {...common} />
      })}
    </div>
  )
}

const offlineDiagnosis = (text) => {
  const lower = text.toLowerCase()
  const hints = []
  if (/scaric|pompa|acqua/.test(lower)) hints.push('Controlla filtro e pompa di scarico, tubo e sifone.')
  if (/scald|resistenz|fredd/.test(lower)) hints.push('Verifica resistenza, termostato/NTC e relè della scheda.')
  if (/rumor|vibra|cuscinett/.test(lower)) hints.push('Controlla cuscinetti, ammortizzatori e corpi estranei nel cesto.')
  if (/non parte|spent|alimentaz/.test(lower)) hints.push('Verifica alimentazione, fusibile, blocco porta e scheda di potenza.')
  if (/perd|gocciol/.test(lower)) hints.push('Controlla guarnizioni, manicotti e tenuta della vasca.')
  if (!hints.length) hints.push('Controllo visivo, prova di alimentazione, verifica cablaggi e componenti principali prima di ordinare ricambi.')
  return `Diagnosi rapida (offline):\n- ${hints.join('\n- ')}`
}

function AiDiagnosis({ subject, description }) {
  const [state, setState] = useState({ loading: false, text: '', error: '' })
  const run = async () => {
    if (!description.trim()) return setState({ loading: false, text: '', error: 'Scrivi prima la descrizione del problema.' })
    setState({ loading: true, text: '', error: '' })
    try {
      const data = await api.post('/api/deepseek', {
        model: 'deepseek-chat',
        stream: false,
        messages: [
          { role: 'system', content: 'Sei un tecnico esperto di elettrodomestici. Analizza il problema e rispondi in italiano con: 1) Possibili cause 2) Verifiche da fare 3) Ricambi probabili. Sii conciso.' },
          { role: 'user', content: `Oggetto: ${subject}. Descrizione: ${description}` },
        ],
      })
      setState({ loading: false, text: data?.choices?.[0]?.message?.content || offlineDiagnosis(description), error: data?.fallback ? 'Assistente AI non configurato: suggerimento offline.' : '' })
    } catch (error) {
      setState({ loading: false, text: offlineDiagnosis(description), error: `AI non disponibile (${error.message}). Suggerimento offline.` })
    }
  }
  return (
    <div className="space-y-2">
      <Button size="sm" variant="secondary" icon={Bot} onClick={run} loading={state.loading}>Suggerisci diagnosi</Button>
      {state.error && <p className="text-xs text-amber-700">{state.error}</p>}
      {state.text && <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{state.text}</pre>}
    </div>
  )
}

function NewInterventionModal({ type, onClose, onCreated, defaults = {} }) {
  const { user } = useAuth()
  const { operators } = useShared()
  const { toast } = useToast()
  const meta = INTERVENTION_TYPES[type]
  const [form, setForm] = useState({
    clientId: defaults.clientId || '', openedAt: toLocalInput(defaults.openedAt || new Date()), urgency: 2, status: 'pendente',
    assignedToId: defaults.assignedToId ?? user.id, description: '', additionalData: {},
  })
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  const submit = async () => {
    if (!form.clientId) return toast('Seleziona o crea il cliente.', 'error')
    setBusy(true)
    try {
      const attachments = await toAttachments(files, user.operatorCode)
      const text = form.description.trim()
      const created = await api.post('/api/interventions', {
        id: newId(),
        clientId: form.clientId,
        type,
        status: form.status,
        urgency: Number(form.urgency),
        assignedToId: form.assignedToId || null,
        openedAt: fromLocalInput(form.openedAt),
        description: text,
        additionalData: {
          ...form.additionalData,
          attachments,
          descriptionEntries: text ? [{ id: newId(), text, authorCode: user.operatorCode, authorName: user.email.split('@')[0], createdAt: new Date().toISOString(), source: 'original' }] : [],
        },
      })
      toast(`${meta.singular} ${created.code} creata.`)
      onCreated(created)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open size="lg" onClose={onClose} title={`Nuova ${meta.singular.toLowerCase()}`} footer={<>
      <Button variant="secondary" onClick={onClose}>Annulla</Button>
      <Button onClick={submit} loading={busy}>Salva {meta.singular.toLowerCase()}</Button>
    </>}>
      <div className="space-y-4">
        <CustomerPicker value={form.clientId} onChange={(clientId) => setForm({ ...form, clientId })} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Input label={type === 'chiamata' ? 'Appuntamento' : 'Data'} type="datetime-local" value={form.openedAt} onChange={set('openedAt')} className="sm:col-span-2" />
          <Select label="Urgenza" value={form.urgency} onChange={set('urgency')}>{Object.entries(URGENCY).map(([v, u]) => <option key={v} value={v}>{u.label}</option>)}</Select>
          <Select label="Assegnata a" value={form.assignedToId || ''} onChange={set('assignedToId')}>
            <option value="">Nessuno</option>
            {operators.map((op) => <option key={op.id} value={op.id}>{op.email.split('@')[0]}</option>)}
          </Select>
        </div>
        <Textarea label="Descrizione del problema / richiesta" rows={4} value={form.description} onChange={set('description')} />
        <TypeFields type={type} data={form.additionalData} onChange={(additionalData) => setForm({ ...form, additionalData })} />
        <div>
          <div className="mb-1 text-sm font-medium text-slate-700">Foto e documenti</div>
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setFiles([...(e.target.files || [])])} className="block w-full text-sm" />
          {files.length > 0 && <p className="mt-1 text-xs text-slate-500">{files.length} file · {fileSize(files.reduce((sum, f) => sum + f.size, 0))}</p>}
        </div>
        {(type === 'chiamata' || type === 'riparazione') && <AiDiagnosis subject={`${meta.singular} ${form.additionalData.applianceBrand || ''}`} description={form.description} />}
      </div>
    </Modal>
  )
}

function PartsUsed({ intervention, canEdit }) {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [qty, setQty] = useState(1)
  const movements = useAsync(() => api.get(`/api/inventory/movements?interventionId=${intervention.id}`), [intervention.id])
  const matches = useAsync(() => (query.trim().length >= 2 ? api.get(`/api/inventory${qs({ q: query.trim(), take: 8, stock: 'available' })}`) : Promise.resolve([])), [query])

  const use = async (item) => {
    try {
      await api.post(`/api/inventory/${item.id}/movements`, { delta: -Math.abs(Number(qty) || 1), reason: 'intervento', interventionId: intervention.id, note: `${intervention.code}` })
      toast(`Scaricato ${item.code} dal magazzino.`)
      setQuery('')
      movements.reload()
    } catch (error) { toast(error.message, 'error') }
  }

  const total = (movements.data || []).reduce((sum, m) => sum - m.delta, 0) // pezzi usati al netto dei resi
  return (
    <div className="space-y-2">
      {(movements.data || []).length === 0 ? <p className="text-sm text-slate-500">Nessun ricambio scaricato per questo intervento.</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {movements.data.map((m) => (
            <li key={m.id} className="flex justify-between py-1.5">
              <span><span className="font-mono">{m.itemCode}</span> · {m.itemName}</span>
              <span className={m.delta < 0 ? 'text-slate-700' : 'text-green-700'}>{m.delta < 0 ? `${-m.delta} pz` : `reso ${m.delta}`} · {fmtDate(m.createdAt)}</span>
            </li>
          ))}
          {total > 0 && <li className="py-1.5 text-right text-xs text-slate-500">{total} pezzi usati</li>}
        </ul>
      )}
      {canEdit && (
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca ricambio in magazzino da scaricare…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" aria-label="Cerca ricambio" />
            </div>
            <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="w-16 rounded-lg border border-slate-300 px-2 text-sm" aria-label="Quantità" />
          </div>
          {(matches.data || []).length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
              {matches.data.map((item) => (
                <button key={item.id} type="button" onClick={() => use(item)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-amber-50">
                  <span><span className="font-mono">{item.code}</span> · {item.name}</span>
                  <span className="text-slate-500">{item.location || ''} · disp. {item.qty}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InterventionDrawer({ id, onClose, onChanged }) {
  const { user, canEdit, isAdmin } = useAuth()
  const { customerById, operators, operatorName } = useShared()
  const { toast, confirm } = useToast()
  const { data: item, loading, error, reload, setData } = useAsync(() => api.get(`/api/interventions/${id}`), [id])
  const googleLink = useAsync(() => api.get(`/api/google/calendar/link/intervention/${id}`).catch(() => null), [id, item?.version])
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])
  const [extra, setExtra] = useState({})
  const [busy, setBusy] = useState('')

  useEffect(() => { if (item) setExtra(item.additionalData || {}) }, [item])

  const customer = item ? customerById(item.customerId) : null
  const meta = item ? INTERVENTION_TYPES[item.type] : null

  const patch = async (body, label) => {
    setBusy(label)
    try {
      const updated = await api.patch(`/api/interventions/${item.id}`, body)
      setData(updated)
      onChanged(updated)
      return updated
    } catch (err) {
      toast(err.message, 'error')
      return null
    } finally {
      setBusy('')
    }
  }

  const saveNoteAndFiles = async () => {
    const text = note.trim()
    if (!text && !files.length) return
    try {
      const newFiles = await toAttachments(files, user.operatorCode)
      const entries = [...descriptionEntries(item)]
      if (text) entries.push({ id: newId(), text, authorCode: user.operatorCode, authorName: user.email.split('@')[0], createdAt: new Date().toISOString(), source: 'note' })
      const updated = await patch({
        note: text || undefined,
        additionalData: { ...item.additionalData, ...extra, descriptionEntries: entries, attachments: [...attachmentsOf(item), ...newFiles] },
      }, 'note')
      if (updated) { setNote(''); setFiles([]); toast('Aggiornamento salvato.') }
    } catch (err) { toast(err.message, 'error') }
  }

  const saveExtra = async () => {
    const updated = await patch({ additionalData: { ...item.additionalData, ...extra } }, 'extra')
    if (updated) toast('Dati salvati.')
  }

  const convert = async () => {
    setBusy('convert')
    try {
      const repair = await api.post(`/api/riparazioni/from-chiamata/${item.id}`)
      toast(`Creata riparazione ${repair.code}.`)
      onChanged(null)
      onClose()
      navigate('riparazioni', { id: repair.id })
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }

  const remove = async () => {
    if (!(await confirm({ title: `Eliminare ${item.code}?`, message: 'Verranno eliminati anche note e storico. Operazione non annullabile.', danger: true, confirmLabel: 'Elimina' }))) return
    try {
      await api.del(`/api/interventions/${item.id}`)
      toast('Intervento eliminato.')
      onChanged(null)
      onClose()
    } catch (err) { toast(err.message, 'error') }
  }

  const removeAttachment = async (attachmentId) => {
    if (!(await confirm({ title: 'Rimuovere allegato?', danger: true, confirmLabel: 'Rimuovi' }))) return
    await patch({ additionalData: { ...item.additionalData, attachments: attachmentsOf(item).filter((a) => a.id !== attachmentId) } }, 'attachment')
  }

  const openAttachment = (attachment) => {
    // I data URL non si aprono direttamente in una nuova scheda: li convertiamo in Blob.
    fetch(attachment.dataUrl).then((r) => r.blob()).then((blob) => window.open(URL.createObjectURL(blob), '_blank', 'noopener'))
  }

  const extraDirty = item && JSON.stringify(Object.fromEntries((TYPE_FIELDS[item.type] || []).map(([k]) => [k, extra?.[k] ?? ''])))
    !== JSON.stringify(Object.fromEntries((TYPE_FIELDS[item.type] || []).map(([k]) => [k, item.additionalData?.[k] ?? ''])))

  return (
    <Modal
      open
      side
      size="lg"
      onClose={onClose}
      title={item ? `${meta?.singular || 'Intervento'} ${item.code}` : 'Intervento'}
      subtitle={item && <span className="flex flex-wrap items-center gap-2"><Badge className={STATUSES[item.status]?.color}>{STATUSES[item.status]?.label}</Badge>aperta {fmtDateTime(item.openedAt)} · {item.durationDays} gg{item.closedAt ? ` · chiusa ${fmtDate(item.closedAt)}` : ''}</span>}
      footer={item && <>
        {isAdmin && <Button variant="dangerGhost" icon={Trash2} onClick={remove} className="mr-auto">Elimina</Button>}
        {googleLink.data?.htmlLink && <a href={googleLink.data.htmlLink} target="_blank" rel="noreferrer"><Button variant="ghost" icon={CalendarDays}>Google Calendar</Button></a>}
        {canEdit && item.type === 'chiamata' && isOpen(item) && <Button variant="secondary" icon={Wrench} onClick={convert} loading={busy === 'convert'}>Porta in laboratorio (riparazione)</Button>}
        <Button variant="secondary" onClick={onClose}>Chiudi</Button>
      </>}
    >
      {loading && !item && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {item && (
        <div className="space-y-6">
          {item.additionalData?.source === 'google' && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">Creata da Google Calendar: «{item.additionalData.googleTitle}». Titolo e note si aggiornano da Google.</p>
          )}
          {customer && (
            <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm">
              <a href={`#/clienti?id=${customer.id}`} className="font-semibold text-slate-900 hover:underline">{customer.name}</a>
              {customer.phone && <a href={`tel:${customer.phone.replace(/\s/g, '')}`} className="flex items-center gap-1 text-slate-700 hover:text-slate-900"><Phone className="h-4 w-4" />{customer.phone}</a>}
              {customer.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-slate-700 hover:text-slate-900"><MapPin className="h-4 w-4" />{customer.address}<ExternalLink className="h-3 w-3" /></a>}
            </Card>
          )}

          <section className="grid gap-3 sm:grid-cols-4">
            <Select label="Stato" value={item.status} disabled={!canEdit || busy === 'status'} onChange={(e) => patch({ status: e.target.value }, 'status')}>
              {Object.entries(STATUSES).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
            </Select>
            <Select label="Urgenza" value={item.urgency} disabled={!canEdit} onChange={(e) => patch({ urgency: Number(e.target.value) }, 'urgency')}>
              {Object.entries(URGENCY).map(([v, u]) => <option key={v} value={v}>{u.label}</option>)}
            </Select>
            <Select label="Assegnata a" value={item.assignedToId || ''} disabled={!canEdit} onChange={(e) => patch({ assignedToId: e.target.value || null }, 'assign')}>
              <option value="">Nessuno</option>
              {operators.map((op) => <option key={op.id} value={op.id}>{op.email.split('@')[0]}</option>)}
              {item.assignedToId && !operators.some((op) => op.id === item.assignedToId) && <option value={item.assignedToId}>{operatorName(item.assignedToId) || 'utente non attivo'}</option>}
            </Select>
            <Input label={item.type === 'chiamata' ? 'Appuntamento' : 'Data'} type="datetime-local" disabled={!canEdit} defaultValue={toLocalInput(item.openedAt)} key={item.openedAt}
              onBlur={(e) => { const next = fromLocalInput(e.target.value); if (next && next !== item.openedAt) patch({ openedAt: next }, 'date') }} />
          </section>

          {(TYPE_FIELDS[item.type] || []).length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Dettagli {meta.singular.toLowerCase()}</h3>
              <TypeFields type={item.type} data={extra} onChange={setExtra} disabled={!canEdit} />
              {canEdit && extraDirty && <Button size="sm" onClick={saveExtra} loading={busy === 'extra'}>Salva dettagli</Button>}
              {item.type === 'preventivo' && Number(extra.quoteTotal) > 0 && <p className="text-sm text-slate-600">Totale: <b>{fmtEuro(extra.quoteTotal)}</b></p>}
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Note e aggiornamenti</h3>
            <ol className="space-y-2">
              {descriptionEntries(item).map((entry) => (
                <li key={entry.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="whitespace-pre-wrap text-slate-800">{entry.text}</div>
                  <div className="mt-1 text-xs text-slate-500">{entry.authorName || entry.authorCode || ''}{entry.createdAt ? ` · ${fmtDateTime(entry.createdAt)}` : ''}</div>
                </li>
              ))}
              {descriptionEntries(item).length === 0 && <li className="text-sm text-slate-500">Nessuna nota.</li>}
            </ol>
            {canEdit && (
              <div className="space-y-2">
                <Textarea rows={2} placeholder="Aggiungi una nota (cosa è stato fatto, cosa manca…)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
                    <Paperclip className="h-4 w-4" /> {files.length ? `${files.length} file selezionati` : 'Allega foto/documenti'}
                    <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => setFiles([...(e.target.files || [])])} />
                  </label>
                  <Button size="sm" className="ml-auto" onClick={saveNoteAndFiles} loading={busy === 'note'} disabled={!note.trim() && !files.length}>Salva aggiornamento</Button>
                </div>
              </div>
            )}
            {(item.type === 'chiamata' || item.type === 'riparazione') && <AiDiagnosis subject={`${meta.singular} ${item.additionalData?.applianceBrand || ''} ${item.additionalData?.applianceModel || ''}`} description={descriptionEntries(item).map((e) => e.text).join('\n')} />}
          </section>

          {attachmentsOf(item).length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Allegati</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {attachmentsOf(item).map((attachment) => (
                  <div key={attachment.id} className="group relative overflow-hidden rounded-lg border border-slate-200">
                    <button type="button" onClick={() => openAttachment(attachment)} className="block w-full text-left">
                      {attachment.mimeType?.startsWith('image/')
                        ? <img src={attachment.dataUrl} alt={attachment.fileName} className="h-24 w-full object-cover" />
                        : <div className="flex h-24 items-center justify-center bg-slate-50"><FileText className="h-8 w-8 text-slate-400" /></div>}
                      <div className="truncate px-2 py-1 text-xs text-slate-600">{attachment.fileName} · {fileSize(attachment.size)}</div>
                    </button>
                    {canEdit && <button type="button" onClick={() => removeAttachment(attachment.id)} className="absolute right-1 top-1 hidden rounded bg-white/90 p-1 text-red-600 group-hover:block" aria-label="Rimuovi allegato"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {(item.type === 'riparazione' || item.type === 'chiamata' || item.type === 'ordine_ricambi') && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Package className="h-4 w-4" /> Ricambi usati dal magazzino</h3>
              <PartsUsed intervention={item} canEdit={canEdit} />
            </section>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">Storico</h3>
            <ul className="space-y-1 text-xs text-slate-500">
              {[...(item.logs || [])].reverse().map((log) => (
                <li key={log.id}>{fmtDateTime(log.createdAt)} · {operatorName(log.userId) || 'sistema'} · {{
                  intervento_creato: 'creato', status_changed: log.note, assigned_operator: `assegnato a ${operatorName(log.note) || log.note}`,
                  note_added: 'nota aggiunta', converted_to_repair: 'convertito in riparazione', created_from_call: 'creato da chiamata',
                  importato_da_google: 'importato da Google Calendar', spostato_da_google: 'spostato su Google Calendar',
                }[log.action] || log.action}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  )
}

function LegacyTickets() {
  const { customerById } = useShared()
  const { canEdit } = useAuth()
  const { toast } = useToast()
  const tickets = useAsync(() => api.get('/api/tickets?take=200'), [])
  const open = (tickets.data || []).filter((t) => !['chiuso', 'completato', 'annullato'].includes(String(t.status).toLowerCase()))
  if (!open.length) return null
  const toRepair = async (ticket) => {
    try {
      const repair = await api.post(`/api/riparazioni/from-chiamata/${ticket.id}`)
      toast(`Creata riparazione ${repair.code}.`)
      tickets.reload()
    } catch (error) { toast(error.message, 'error') }
  }
  const close = async (ticket) => {
    try { await api.put(`/api/tickets/${ticket.id}`, { ...ticket, status: 'chiuso' }); tickets.reload() } catch (error) { toast(error.message, 'error') }
  }
  return (
    <Card className="border-amber-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Ticket della vecchia versione ancora aperti ({open.length})</h3>
      <p className="mb-2 text-xs text-slate-500">Trasformali in riparazione oppure chiudili: i ticket non vengono più creati.</p>
      <ul className="divide-y divide-slate-100 text-sm">
        {open.map((ticket) => (
          <li key={ticket.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1"><b>{ticket.subject}</b> · {customerById(ticket.customerId)?.name || 'senza cliente'}{ticket.date ? ` · ${ticket.date}` : ''}</span>
            {canEdit && ticket.customerId && <Button size="sm" variant="secondary" onClick={() => toRepair(ticket)}>Crea riparazione</Button>}
            {canEdit && <Button size="sm" variant="ghost" onClick={() => close(ticket)}>Chiudi</Button>}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function Interventions({ type, params = {} }) {
  const { user, canEdit } = useAuth()
  const { customerById, operatorName, operators } = useShared()
  const meta = INTERVENTION_TYPES[type]
  const [view, setView] = useState(params.view || 'open')
  const [search, setSearch] = useState('')
  const [urgency, setUrgency] = useState('')
  const [assigned, setAssigned] = useState(params.assigned || '')
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [openId, setOpenId] = useState(params.id || null)
  const [paramId, setParamId] = useState(params.id)
  if (params.id !== paramId) { setParamId(params.id); if (params.id) setOpenId(params.id) }
  const [creating, setCreating] = useState(params.new === '1')
  const query = useDebounced(search.trim(), 300)

  // La pagina torna alla prima quando cambiano ricerca o filtri.
  const filterKey = JSON.stringify([query, view, urgency, assigned])
  const page = pageState.key === filterKey ? pageState.page : 0
  const setPage = (next) => setPageState({ key: filterKey, page: next })

  const stats = useAsync(() => api.get('/api/interventions/stats'), [])
  const filters = useMemo(() => ({
    type, q: query, urgency, light: 1, withTotal: 1,
    assignedToId: assigned === 'me' ? user.id : assigned,
    ...(view === 'open' ? { open: 1 } : view === 'all' ? {} : { status: view }),
    sort: view === 'open' ? 'openedAt' : 'openedAt', order: view === 'open' ? 'asc' : 'desc',
  }), [type, query, urgency, assigned, view, user.id])

  const list = useAsync(async () => {
    const response = await request('GET', `/api/interventions${qs({ ...filters, skip: page * PAGE_SIZE, take: PAGE_SIZE })}`, undefined, { raw: true })
    return { rows: await response.json(), total: Number(response.headers.get('X-Total-Count') || 0) }
  }, [filters, page])

  const onChanged = () => { list.reload(); stats.reload() }
  const s = stats.data?.[type]
  const rows = list.data?.rows || []

  const exportCsv = () => {
    const header = ['Codice', 'Cliente', 'Telefono', 'Stato', 'Urgenza', 'Data', 'Assegnata', 'Descrizione']
    const lines = rows.map((r) => [r.code, r.customerName, r.customerPhone, STATUSES[r.status]?.label, URGENCY[r.urgency]?.label, fmtDateTime(r.openedAt), operatorName(r.assignedToId), (r.description || '').replace(/\s+/g, ' ')])
    const csv = `\uFEFF${[header, ...lines].map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')}`
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `${meta.route}.csv` })
    link.click()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{meta.label}</h1>
          <p className="text-sm text-slate-500">{s ? `${s.open} aperte · ${s.urgent} urgenti · ${s.unassigned} da assegnare · ${s.closedThisMonth} chiuse questo mese` : ' '}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={!rows.length}>Esporta</Button>
          {canEdit && <Button icon={Plus} onClick={() => setCreating(true)}>Nuova {meta.singular.toLowerCase()}</Button>}
        </div>
      </div>

      {type === 'chiamata' && <LegacyTickets />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Aperte" value={s?.open ?? '…'} onClick={() => setView('open')} />
        <Stat label="Urgenti" value={s?.urgent ?? '…'} tone={s?.urgent ? 'danger' : 'default'} onClick={() => { setView('open'); setUrgency('3') }} />
        <Stat label="Da assegnare" value={s?.unassigned ?? '…'} tone={s?.unassigned ? 'warn' : 'default'} onClick={() => { setView('open'); setAssigned('none') }} />
        <Stat label="Totali" value={s?.total ?? '…'} onClick={() => setView('all')} />
      </div>

      <Card>
        <div className="space-y-3 border-b border-slate-200 p-4">
          <Tabs value={view} onChange={setView} tabs={[
            { value: 'open', label: 'Aperte' }, { value: 'pendente', label: 'Da fare' }, { value: 'in_lavorazione', label: 'In lavorazione' },
            { value: 'completato', label: 'Completate' }, { value: 'annullato', label: 'Annullate' }, { value: 'all', label: 'Tutte' },
          ]} />
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca per codice, cliente o descrizione…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200" aria-label="Cerca" />
            </div>
            <Select aria-label="Urgenza" value={urgency} onChange={(e) => setUrgency(e.target.value)} className="w-40">
              <option value="">Tutte le urgenze</option>
              {Object.entries(URGENCY).map(([v, u]) => <option key={v} value={v}>{u.label}</option>)}
            </Select>
            <Select aria-label="Assegnazione" value={assigned} onChange={(e) => setAssigned(e.target.value)} className="w-44">
              <option value="">Tutti gli operatori</option>
              <option value="me">Assegnate a me</option>
              <option value="none">Non assegnate</option>
              {operators.filter((op) => op.id !== user.id).map((op) => <option key={op.id} value={op.id}>{op.email.split('@')[0]}</option>)}
            </Select>
          </div>
        </div>
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title={`Nessuna ${meta.singular.toLowerCase()} ${view === 'open' ? 'aperta' : 'trovata'}`} action={canEdit && <Button variant="secondary" icon={Plus} onClick={() => setCreating(true)}>Nuova {meta.singular.toLowerCase()}</Button>} />
        ) : (
          <ul className={cx('divide-y divide-slate-100', list.loading && 'opacity-60')}>
            {rows.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => setOpenId(row.id)} className="flex w-full flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-amber-50/40">
                  <span className={cx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', STATUSES[row.status]?.dot)} title={STATUSES[row.status]?.label} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{row.customerName || customerById(row.customerId)?.name}</span>
                      {row.urgency === 3 && <Badge className="bg-red-100 text-red-700">Urgente</Badge>}
                      {row.additionalData?.attachmentsCount > 0 && <span className="flex items-center gap-0.5 text-xs text-slate-400"><Paperclip className="h-3 w-3" />{row.additionalData.attachmentsCount}</span>}
                    </div>
                    <div className="truncate text-sm text-slate-600">{row.description || [row.additionalData?.applianceBrand, row.additionalData?.defect, row.additionalData?.sparePartCode, row.additionalData?.quoteItems].filter(Boolean).join(' · ') || '—'}</div>
                    <div className="text-xs text-slate-400">{row.code}{row.customerPhone ? ` · ${row.customerPhone}` : ''}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-slate-700">{fmtDateTime(row.openedAt)}</div>
                    <div className="text-xs text-slate-500">{isOpen(row) ? relativeDays(row.openedAt) : STATUSES[row.status]?.label}{row.assignedToId ? ` · ${operatorName(row.assignedToId)}` : ''}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} count={rows.length} total={list.data?.total} onChange={setPage} />
      </Card>

      {creating && <NewInterventionModal type={type} defaults={{ clientId: params.customerId }} onClose={() => setCreating(false)} onCreated={(created) => { setCreating(false); onChanged(); setOpenId(created.id) }} />}
      {openId && <InterventionDrawer id={openId} onClose={() => { setOpenId(null); if (params.id) navigate(meta.route) }} onChanged={onChanged} />}
    </div>
  )
}

export { NewInterventionModal, InterventionDrawer }
