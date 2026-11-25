import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, Download, FileUp, History, Minus, Plus, Search, Trash2 } from 'lucide-react'
import { ApiError, api, download, qs, request } from '../lib/api'
import { useAuth } from '../lib/auth'
import { MOVEMENT_REASONS } from '../lib/domain'
import { fmtDateTime, fmtEuro, fmtNumber } from '../lib/format'
import { navigate, useAsync } from '../lib/hooks'
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Modal, Pagination, Select, Spinner, Stat, Tabs, Textarea, cx, useDebounced, useToast } from '../components/ui'

const PAGE_SIZE = 50
const SORTS = {
  name: 'Descrizione A→Z',
  code: 'Codice',
  location: 'Posizione',
  'qty:asc': 'Quantità (meno disponibili)',
  'updatedAt:desc': 'Modificati di recente',
  'price:desc': 'Prezzo (più alto)',
}

const stockBadge = (item) => {
  if (item.qty <= 0) return <Badge className="bg-red-100 text-red-700">Esaurito</Badge>
  if (item.lowStock) return <Badge className="bg-amber-100 text-amber-800">Sotto scorta</Badge>
  return null
}

const emptyItem = { code: '', name: '', alternateCodes: '', location: '', qty: 0, price: '', minQty: 0 }

function ItemForm({ value, onChange, isNew }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Codice *" value={value.code} onChange={set('code')} required autoFocus={isNew} />
      <Input label="Posizione" value={value.location} onChange={set('location')} placeholder="es. A-01-B" />
      <Input label="Descrizione *" className="sm:col-span-2" value={value.name} onChange={set('name')} required />
      <Input label="Codici alternativi" className="sm:col-span-2" value={value.alternateCodes} onChange={set('alternateCodes')} hint="Codici equivalenti di altre marche, separati da spazio: la ricerca li trova tutti." />
      <Input label="Prezzo al pubblico (€)" inputMode="decimal" value={value.price} onChange={set('price')} placeholder="0,00" />
      <Input label="Scorta minima" type="number" min="0" value={value.minQty} onChange={set('minQty')} hint="Avviso quando la quantità scende a questo valore." />
      {isNew && <Input label="Quantità iniziale" type="number" value={value.qty} onChange={set('qty')} />}
    </div>
  )
}

function MovementForm({ item, onDone }) {
  const { toast } = useToast()
  const [direction, setDirection] = useState('out')
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('scarico')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const choose = (next) => { setDirection(next); setReason(next === 'out' ? 'scarico' : 'carico') }

  const submit = async (event) => {
    event.preventDefault()
    const amount = Math.abs(parseInt(qty, 10) || 0)
    if (!amount) return toast('Indica una quantità.', 'error')
    setBusy(true)
    try {
      const updated = await api.post(`/api/inventory/${item.id}/movements`, { delta: direction === 'out' ? -amount : amount, reason, note })
      toast(`${direction === 'out' ? 'Scaricati' : 'Caricati'} ${amount} pz · giacenza ${updated.qty}`)
      setNote('')
      setQty(1)
      onDone(updated)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const reasons = direction === 'out' ? ['scarico', 'intervento', 'reso', 'rettifica'] : ['carico', 'reso', 'rettifica']
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-slate-50 p-3">
      <div className="flex gap-2">
        <Button variant={direction === 'out' ? 'primary' : 'secondary'} icon={ArrowUpFromLine} onClick={() => choose('out')}>Scarico</Button>
        <Button variant={direction === 'in' ? 'primary' : 'secondary'} icon={ArrowDownToLine} onClick={() => choose('in')}>Carico</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Quantità" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        <Select label="Causale" value={reason} onChange={(e) => setReason(e.target.value)} className="sm:col-span-2">
          {reasons.map((key) => <option key={key} value={key}>{MOVEMENT_REASONS[key]}</option>)}
        </Select>
      </div>
      <Input label="Nota" value={note} onChange={(e) => setNote(e.target.value)} placeholder="es. cliente Rossi, fornitore, n. DDT…" />
      <Button type="submit" loading={busy}>Registra {direction === 'out' ? 'scarico' : 'carico'}</Button>
    </form>
  )
}

function MovementList({ movements, showItem = false }) {
  if (!movements?.length) return <p className="py-4 text-center text-sm text-slate-500">Nessun movimento registrato.</p>
  return (
    <ul className="divide-y divide-slate-100">
      {movements.map((movement) => (
        <li key={movement.id} className="flex items-start gap-3 py-2 text-sm">
          <span className={cx('w-14 shrink-0 text-right font-mono font-semibold', movement.delta > 0 ? 'text-green-700' : 'text-red-600')}>
            {movement.delta > 0 ? '+' : ''}{movement.delta}
          </span>
          <div className="min-w-0 flex-1">
            {showItem && <div className="truncate font-medium text-slate-800">{movement.itemCode} · {movement.itemName}</div>}
            <div className="text-slate-700">{MOVEMENT_REASONS[movement.reason] || movement.reason}{movement.note ? ` — ${movement.note}` : ''}</div>
            <div className="text-xs text-slate-500">{fmtDateTime(movement.createdAt)}{movement.userEmail ? ` · ${movement.userEmail.split('@')[0]}` : ''}{movement.interventionId ? ' · collegato a intervento' : ''}</div>
          </div>
          <span className="shrink-0 text-xs text-slate-500">giac. {movement.qtyAfter}</span>
        </li>
      ))}
    </ul>
  )
}

function ItemDrawer({ itemId, onClose, onChanged }) {
  const { canEdit } = useAuth()
  const { toast, confirm } = useToast()
  const { data: item, loading, error, reload, setData } = useAsync(() => api.get(`/api/inventory/${itemId}`), [itemId])
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) setForm({ ...item, price: Number(item.price || 0).toFixed(2).replace('.', ',') })
  }, [item])

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.put(`/api/inventory/${item.id}`, { ...form, qty: item.qty, version: item.version })
      setData((prev) => ({ ...prev, ...updated }))
      onChanged(updated)
      toast('Articolo aggiornato.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') {
        toast('Un altro operatore ha modificato questo articolo: ricarico i dati aggiornati.', 'error')
        reload()
      } else toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!(await confirm({ title: 'Eliminare articolo?', message: `${item.code} — ${item.name} verrà eliminato con tutto lo storico movimenti.`, danger: true, confirmLabel: 'Elimina' }))) return
    try {
      await api.del(`/api/inventory/${item.id}`)
      toast('Articolo eliminato.')
      onChanged(null, item.id)
      onClose()
    } catch (err) { toast(err.message, 'error') }
  }

  const dirty = form && item && ['code', 'name', 'alternateCodes', 'location', 'minQty'].some((key) => String(form[key] ?? '') !== String(item[key] ?? ''))
    || (form && item && Number(String(form.price).replace(',', '.')) !== Number(item.price))

  return (
    <Modal
      open
      side
      size="md"
      onClose={onClose}
      title={item ? item.name : 'Articolo'}
      subtitle={item && <span className="font-mono">{item.code}</span>}
      footer={item && canEdit && <>
        <Button variant="dangerGhost" icon={Trash2} onClick={remove} className="mr-auto">Elimina</Button>
        <Button variant="secondary" onClick={onClose}>Chiudi</Button>
        <Button onClick={save} loading={saving} disabled={!dirty}>Salva modifiche</Button>
      </>}
    >
      {loading && !item && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {item && form && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Giacenza" value={fmtNumber(item.qty)} tone={item.qty <= 0 ? 'danger' : item.lowStock ? 'warn' : 'default'} hint={item.minQty ? `minimo ${item.minQty}` : undefined} />
            <Stat label="Prezzo" value={fmtEuro(item.price)} hint={item.priceDate ? `dal ${item.priceDate}` : undefined} />
            <Stat label="Valore" value={fmtEuro(Math.max(0, item.qty) * item.price)} />
          </div>
          {canEdit && <MovementForm item={item} onDone={(updated) => { onChanged(updated); reload() }} />}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Scheda</h3>
            <fieldset disabled={!canEdit}><ItemForm value={form} onChange={setForm} /></fieldset>
          </div>
          <div>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700"><History className="h-4 w-4" /> Storico movimenti</h3>
            <MovementList movements={item.movements} />
          </div>
        </div>
      )}
    </Modal>
  )
}

function NewItemModal({ onClose, onCreated, initialCode = '' }) {
  const { toast } = useToast()
  const [form, setForm] = useState({ ...emptyItem, code: initialCode })
  const [busy, setBusy] = useState(false)
  const [duplicate, setDuplicate] = useState(null)

  const submit = async (event) => {
    event?.preventDefault()
    if (!form.code.trim() || !form.name.trim()) return toast('Codice e descrizione sono obbligatori.', 'error')
    setBusy(true)
    try {
      const created = await api.post('/api/inventory', form)
      toast('Articolo creato.')
      onCreated(created)
    } catch (error) {
      if (error.code === 'code_exists') setDuplicate(error.data?.current)
      else toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuovo articolo" footer={<>
      <Button variant="secondary" onClick={onClose}>Annulla</Button>
      <Button onClick={submit} loading={busy}>Crea articolo</Button>
    </>}>
      <form onSubmit={submit}>
        <ItemForm value={form} onChange={(next) => { setForm(next); setDuplicate(null) }} isNew />
        <button type="submit" className="hidden" />
      </form>
      {duplicate && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">Esiste già <b>{duplicate.code}</b> — {duplicate.name} (giacenza {duplicate.qty}).</span>
          <Button size="sm" variant="secondary" onClick={() => onCreated(duplicate, { openOnly: true })}>Apri esistente</Button>
        </div>
      )}
    </Modal>
  )
}

function ImportModal({ onClose, onImported }) {
  const { toast } = useToast()
  const [file, setFile] = useState(null)
  const [csv, setCsv] = useState('')
  const [mode, setMode] = useState('add')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const readFile = async (selected) => {
    setPreview(null)
    setFile(selected)
    if (!selected) return setCsv('')
    if (/\.xlsx?$/i.test(selected.name)) {
      setCsv('')
      return toast('Apri il file in Excel e salvalo come "CSV UTF-8 (delimitato da separatore)", poi caricalo qui.', 'error')
    }
    setCsv(await selected.text())
  }

  const run = async (dryRun) => {
    setBusy(true)
    try {
      const report = await api.post('/api/inventory/import', { csv, mode, dryRun })
      if (dryRun) setPreview(report)
      else {
        toast(`Import completato: ${report.created} nuovi, ${report.updated} aggiornati.`)
        onImported()
        onClose()
      }
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { if (csv) run(true) }, [csv, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open size="lg" onClose={onClose} title="Importa magazzino da file" footer={<>
      <Button variant="secondary" onClick={() => download('/api/import/template', 'template_magazzino.csv')} icon={Download} className="mr-auto">Scarica modello</Button>
      <Button variant="secondary" onClick={onClose}>Annulla</Button>
      <Button onClick={() => run(false)} loading={busy && Boolean(preview)} disabled={!preview || (preview.created + preview.updated === 0)}>Conferma import</Button>
    </>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">File CSV con le colonne <b>POSIZIONE; CODICE; DESCRIZIONE; PREZZO AL PUBBLICO; QUANTITA</b> (facoltative: SCORTA MINIMA, CODICI ALTERNATIVI). L&apos;export del magazzino è già in questo formato.</p>
        <input type="file" accept=".csv,text/csv,.txt,.xlsx" onChange={(e) => readFile(e.target.files?.[0] || null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-white" />
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ['add', 'Somma alle quantità', 'Arrivo merce: le quantità del file si aggiungono alla giacenza.'],
            ['set', 'Sostituisci le quantità', 'Inventario fisico: la giacenza diventa quella del file.'],
          ].map(([value, title, text]) => (
            <label key={value} className={cx('cursor-pointer rounded-lg border p-3 text-sm', mode === value ? 'border-amber-400 bg-amber-50' : 'border-slate-200')}>
              <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mr-2" />
              <b>{title}</b>
              <p className="mt-1 text-slate-600">{text}</p>
            </label>
          ))}
        </div>
        {busy && !preview && <Spinner label="Analisi del file…" />}
        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Nuovi" value={preview.created} tone="ok" />
              <Stat label="Aggiornati" value={preview.updated} />
              <Stat label="Invariati" value={preview.unchanged} />
              <Stat label="Scartati" value={preview.skipped.length} tone={preview.skipped.length ? 'warn' : 'default'} />
            </div>
            {preview.skipped.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <b>Righe scartate:</b>
                <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5">
                  {preview.skipped.slice(0, 50).map((row) => <li key={`${row.line}-${row.code || ''}`}>riga {row.line}{row.code ? ` (${row.code})` : ''}: {row.reason}</li>)}
                </ul>
              </div>
            )}
            {preview.items.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Riga</th><th className="px-3 py-2">Codice</th><th className="px-3 py-2">Esito</th><th className="px-3 py-2 text-right">Quantità</th></tr></thead>
                  <tbody>
                    {preview.items.slice(0, 200).map((row) => (
                      <tr key={`${row.line}-${row.code}`} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-500">{row.line}</td>
                        <td className="px-3 py-1.5 font-mono">{row.code}</td>
                        <td className="px-3 py-1.5">{row.action === 'created' ? 'nuovo' : 'aggiornato'}</td>
                        <td className="px-3 py-1.5 text-right">{row.qtyBefore} → <b>{row.qtyAfter}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-500">Anteprima: niente è stato ancora salvato.{file ? ` File: ${file.name}` : ''}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function Inventory({ params = {} }) {
  const { canEdit } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState(params.tab === 'movimenti' ? 'movimenti' : 'articoli')
  const [search, setSearch] = useState(params.q || '')
  const [stock, setStock] = useState(params.stock || '')
  const [location, setLocation] = useState('')
  const [sort, setSort] = useState('name')
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [openId, setOpenId] = useState(params.id || null)
  const [routeParams, setRouteParams] = useState(params)
  if (params !== routeParams) {
    setRouteParams(params)
    if (params.stock !== undefined && params.stock !== stock) setStock(params.stock)
    if (params.id && params.id !== openId) setOpenId(params.id)
  }
  const [creating, setCreating] = useState(null)
  const [importing, setImporting] = useState(false)
  const [busyRow, setBusyRow] = useState(null)
  const searchRef = useRef(null)
  const query = useDebounced(search.trim(), 250)

  const filterKey = JSON.stringify([query, stock, location, sort])
  const page = pageState.key === filterKey ? pageState.page : 0
  const setPage = (next) => setPageState({ key: filterKey, page: next })

  const summary = useAsync(() => api.get('/api/inventory/summary'), [])
  const [sortKey, sortOrder = 'asc'] = sort.split(':')
  const list = useAsync(async () => {
    const response = await request('GET', `/api/inventory${qs({ q: query, stock, location, sort: sortKey, order: sortOrder, skip: page * PAGE_SIZE, take: PAGE_SIZE, withTotal: 1 })}`, undefined, { raw: true })
    return { rows: await response.json(), total: Number(response.headers.get('X-Total-Count') || 0) }
  }, [query, stock, location, sortKey, sortOrder, page])
  const movements = useAsync(() => (tab === 'movimenti' ? api.get('/api/inventory/movements?take=200') : Promise.resolve(null)), [tab])

  const refreshAll = useCallback(() => { list.reload(); summary.reload() }, [list, summary])

  const updateRow = (updated, removedId) => {
    list.setData((prev) => prev && ({
      ...prev,
      rows: removedId ? prev.rows.filter((row) => row.id !== removedId) : prev.rows.map((row) => (row.id === updated.id ? updated : row)),
    }))
    summary.reload()
  }

  const quickMove = async (item, delta) => {
    setBusyRow(item.id)
    try {
      const updated = await api.post(`/api/inventory/${item.id}/movements`, { delta, reason: delta > 0 ? 'carico' : 'scarico', note: 'Movimento rapido' })
      updateRow(updated)
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusyRow(null)
    }
  }

  // Lettore di codici a barre / Invio: se il codice corrisponde esattamente apriamo l'articolo,
  // altrimenti proponiamo di crearlo.
  const onSearchKey = async (event) => {
    if (event.key !== 'Enter' || !search.trim()) return
    const rows = await api.get(`/api/inventory${qs({ q: search.trim(), take: 20 })}`).catch(() => [])
    const exact = rows.find((row) => row.code.toLowerCase() === search.trim().toLowerCase()
      || row.alternateCodes.toLowerCase().split(/[\s,;]+/).includes(search.trim().toLowerCase()))
    if (exact) setOpenId(exact.id)
    else if (rows.length === 1) setOpenId(rows[0].id)
    else if (!rows.length && canEdit) setCreating(search.trim())
  }

  const s = summary.data
  const rows = list.data?.rows || []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Magazzino</h1>
          <p className="text-sm text-slate-500">Ricambi, giacenze e movimenti. Scrivi o scansiona un codice e premi Invio.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Download} onClick={() => download(`/api/inventory/export.csv${qs({ q: query, stock, location })}`, 'magazzino.csv')}>Export Excel</Button>
          {canEdit && <Button variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>Importa file</Button>}
          {canEdit && <Button icon={Plus} onClick={() => setCreating('')}>Nuovo articolo</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Articoli" value={s ? fmtNumber(s.items) : '…'} icon={Boxes} onClick={() => setStock('')} />
        <Stat label="Pezzi" value={s ? fmtNumber(s.pieces) : '…'} />
        <Stat label="Valore" value={s ? fmtEuro(s.value) : '…'} hint="al prezzo al pubblico" />
        <Stat label="Sotto scorta" value={s ? s.lowStock : '…'} tone={s?.lowStock ? 'warn' : 'default'} onClick={() => setStock('low')} />
        <Stat label="Esauriti" value={s ? s.outOfStock : '…'} tone={s?.outOfStock ? 'danger' : 'default'} onClick={() => setStock('out')} />
      </div>

      <Tabs value={tab} onChange={(value) => { setTab(value); navigate('magazzino', value === 'movimenti' ? { tab: value } : {}) }} tabs={[
        { value: 'articoli', label: 'Articoli', count: list.data?.total },
        { value: 'movimenti', label: 'Movimenti recenti' },
      ]} />

      {tab === 'articoli' && (
        <Card>
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
            <div className="relative min-w-[16rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                ref={searchRef}
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Codice, codice alternativo, descrizione o posizione…"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
                aria-label="Cerca nel magazzino"
              />
            </div>
            <Select aria-label="Filtro giacenza" value={stock} onChange={(e) => setStock(e.target.value)} className="w-full sm:w-44">
              <option value="">Tutte le giacenze</option>
              <option value="available">Disponibili</option>
              <option value="low">Sotto scorta</option>
              <option value="out">Esauriti</option>
            </Select>
            <Select aria-label="Filtro posizione" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full sm:w-40">
              <option value="">Tutte le posizioni</option>
              {(s?.locations || []).filter((l) => l.location !== '—').map((l) => <option key={l.location} value={l.location}>{l.location} ({l.items})</option>)}
            </Select>
            <Select aria-label="Ordinamento" value={sort} onChange={(e) => setSort(e.target.value)} className="w-full sm:w-56">
              {Object.entries(SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </div>
          <ErrorBox error={list.error} onRetry={list.reload} />
          {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? (
            <EmptyState icon={Boxes} title={query || stock || location ? 'Nessun articolo trovato' : 'Magazzino vuoto'} action={canEdit && (query
              ? <Button variant="secondary" icon={Plus} onClick={() => setCreating(query)}>Crea &quot;{query}&quot;</Button>
              : <Button variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>Importa da file</Button>)}>
              {query ? 'Prova con meno parole o con un codice alternativo.' : 'Aggiungi gli articoli uno alla volta o importa il file Excel.'}
            </EmptyState>
          ) : (
            <div className={cx('overflow-x-auto', list.loading && 'opacity-60')}>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Codice</th>
                    <th className="px-4 py-2">Descrizione</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Posizione</th>
                    <th className="hidden px-4 py-2 text-right sm:table-cell">Prezzo</th>
                    <th className="px-4 py-2 text-center">Quantità</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id} className="cursor-pointer border-t border-slate-100 hover:bg-amber-50/40" onClick={() => setOpenId(item.id)}>
                      <td className="px-3 py-2 align-top sm:px-4">
                        <div className="break-all font-mono font-medium text-slate-900">{item.code}</div>
                        {item.alternateCodes && <div className="max-w-[12rem] truncate font-mono text-xs text-slate-400" title={item.alternateCodes}>{item.alternateCodes}</div>}
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="text-slate-800">{item.name}</div>
                        <div className="text-xs text-slate-500 sm:hidden">{[item.location, fmtEuro(item.price)].filter(Boolean).join(' · ')}</div>
                        <div className="mt-0.5">{stockBadge(item)}</div>
                      </td>
                      <td className="hidden px-4 py-2 align-top text-slate-600 sm:table-cell">{item.location || '—'}</td>
                      <td className="hidden px-4 py-2 text-right align-top sm:table-cell">{fmtEuro(item.price)}</td>
                      <td className="px-4 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && <Button size="sm" variant="ghost" aria-label={`Scarica 1 ${item.code}`} disabled={busyRow === item.id || item.qty <= 0} onClick={() => quickMove(item, -1)}><Minus className="h-4 w-4" /></Button>}
                          <span className={cx('w-10 text-center font-semibold', item.qty <= 0 ? 'text-red-600' : item.lowStock ? 'text-amber-600' : 'text-slate-900')}>{item.qty}</span>
                          {canEdit && <Button size="sm" variant="ghost" aria-label={`Carica 1 ${item.code}`} disabled={busyRow === item.id} onClick={() => quickMove(item, 1)}><Plus className="h-4 w-4" /></Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} count={rows.length} total={list.data?.total} onChange={setPage} />
        </Card>
      )}

      {tab === 'movimenti' && (
        <Card className="p-4">
          <ErrorBox error={movements.error} onRetry={movements.reload} />
          {movements.loading && !movements.data ? <Spinner /> : <MovementList movements={movements.data} showItem />}
        </Card>
      )}

      {openId && <ItemDrawer itemId={openId} onClose={() => { setOpenId(null); searchRef.current?.focus() }} onChanged={updateRow} />}
      {creating !== null && (
        <NewItemModal
          initialCode={creating}
          onClose={() => setCreating(null)}
          onCreated={(item, { openOnly } = {}) => { setCreating(null); if (!openOnly) refreshAll(); setOpenId(item.id) }}
        />
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} onImported={refreshAll} />}
    </div>
  )
}
