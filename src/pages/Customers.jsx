import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, MapPin, Phone, Plus, Search, Trash2, Users } from 'lucide-react'
import { api, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { INTERVENTION_TYPES, STATUSES } from '../lib/domain'
import { fmtDate, newId } from '../lib/format'
import { navigate, useAsync, useShared } from '../lib/hooks'
import { Badge, Button, Card, EmptyState, Input, Modal, Spinner, Textarea, useDebounced, useToast } from '../components/ui'

const emptyCustomer = { name: '', phone: '', email: '', address: '' }

function CustomerForm({ value, onChange }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Nome / ragione sociale *" className="sm:col-span-2" value={value.name} onChange={set('name')} autoFocus />
      <Input label="Telefono" type="tel" value={value.phone || ''} onChange={set('phone')} />
      <Input label="Email" type="email" value={value.email || ''} onChange={set('email')} />
      <Textarea label="Indirizzo" rows={2} className="sm:col-span-2" value={value.address || ''} onChange={set('address')} />
    </div>
  )
}

function CustomerDrawer({ customer, onClose }) {
  const { canEdit, isAdmin } = useAuth()
  const { upsertCustomer, reloadCustomers } = useShared()
  const { toast, confirm } = useToast()
  const [form, setForm] = useState(customer)
  const [busy, setBusy] = useState(false)
  const history = useAsync(() => api.get(`/api/interventions${qs({ customerId: customer.id, take: 200, light: 1, sort: 'openedAt', order: 'desc' })}`), [customer.id])
  useEffect(() => setForm(customer), [customer])

  const dirty = ['name', 'phone', 'email', 'address'].some((key) => (form[key] || '') !== (customer[key] || ''))

  const save = async () => {
    setBusy(true)
    try {
      const updated = await api.put(`/api/customers/${customer.id}`, form)
      upsertCustomer(updated)
      toast('Cliente aggiornato.')
    } catch (error) { toast(error.message, 'error') } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!(await confirm({ title: `Eliminare ${customer.name}?`, message: 'Il cliente verrà eliminato definitivamente.', danger: true, confirmLabel: 'Elimina' }))) return
    try {
      await api.del(`/api/customers/${customer.id}`)
      await reloadCustomers()
      toast('Cliente eliminato.')
      onClose()
    } catch (error) { toast(error.message, 'error') }
  }

  return (
    <Modal open side size="lg" onClose={onClose} title={customer.name} subtitle={`Cliente dal ${fmtDate(customer.createdAt)}`} footer={<>
      {isAdmin && <Button variant="dangerGhost" icon={Trash2} onClick={remove} className="mr-auto">Elimina</Button>}
      <Button variant="secondary" onClick={onClose}>Chiudi</Button>
      {canEdit && <Button onClick={save} loading={busy} disabled={!dirty || !form.name.trim()}>Salva</Button>}
    </>}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {customer.phone && <a href={`tel:${customer.phone.replace(/\s/g, '')}`}><Button variant="secondary" icon={Phone}>Chiama</Button></a>}
          {customer.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address)}`} target="_blank" rel="noreferrer"><Button variant="secondary" icon={MapPin}>Mappa <ExternalLink className="h-3 w-3" /></Button></a>}
          {canEdit && Object.entries(INTERVENTION_TYPES).map(([type, meta]) => (
            <Button key={type} variant="ghost" icon={Plus} onClick={() => navigate(meta.route, { new: 1, customerId: customer.id })}>{meta.singular}</Button>
          ))}
        </div>
        <fieldset disabled={!canEdit}><CustomerForm value={form} onChange={setForm} /></fieldset>
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Storico interventi</h3>
          {history.loading && !history.data ? <Spinner /> : (history.data || []).length === 0 ? <p className="text-sm text-slate-500">Nessun intervento.</p> : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {history.data.map((item) => (
                <li key={item.id}>
                  <a href={`#/${INTERVENTION_TYPES[item.type].route}?id=${item.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                    <Badge className={INTERVENTION_TYPES[item.type].color}>{INTERVENTION_TYPES[item.type].singular}</Badge>
                    <span className="min-w-0 flex-1 truncate">{item.description || item.code}</span>
                    <Badge className={STATUSES[item.status]?.color}>{STATUSES[item.status]?.label}</Badge>
                    <span className="w-20 text-right text-xs text-slate-500">{fmtDate(item.openedAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}

export default function Customers({ params = {} }) {
  const { canEdit } = useAuth()
  const { customers, loaded, customerById, upsertCustomer } = useShared()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState(emptyCustomer)
  const [openId, setOpenId] = useState(params.id || null)
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(100)
  const query = useDebounced(search, 150)
  useEffect(() => { if (params.id) setOpenId(params.id) }, [params.id])

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return customers
    return customers.filter((c) => terms.every((t) => [c.name, c.phone, c.email, c.address].some((f) => String(f || '').toLowerCase().includes(t))))
  }, [customers, query])

  const create = async () => {
    if (!draft.name.trim()) return toast('Il nome è obbligatorio.', 'error')
    const duplicate = customers.find((c) => (draft.phone && c.phone && c.phone.replace(/\D/g, '') === draft.phone.replace(/\D/g, '')))
    if (duplicate) toast(`Attenzione: stesso telefono di ${duplicate.name}.`, 'info')
    setBusy(true)
    try {
      const created = await api.post('/api/customers', { ...draft, id: newId() })
      upsertCustomer(created)
      setCreating(false)
      setDraft(emptyCustomer)
      setOpenId(created.id)
      toast('Cliente creato.')
    } catch (error) { toast(error.message, 'error') } finally { setBusy(false) }
  }

  const open = openId ? customerById(openId) : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clienti</h1>
          <p className="text-sm text-slate-500">{customers.length} clienti in archivio</p>
        </div>
        {canEdit && <Button icon={Plus} onClick={() => setCreating(true)}>Nuovo cliente</Button>}
      </div>
      <Card>
        <div className="border-b border-slate-200 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca per nome, telefono, email o indirizzo…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200" aria-label="Cerca cliente" />
          </div>
        </div>
        {!loaded ? <Spinner /> : filtered.length === 0 ? <EmptyState icon={Users} title="Nessun cliente trovato" /> : (
          <>
            <ul className="divide-y divide-slate-100">
              {filtered.slice(0, limit).map((customer) => (
                <li key={customer.id}>
                  <button type="button" onClick={() => setOpenId(customer.id)} className="flex w-full flex-wrap items-center gap-x-4 px-4 py-2.5 text-left text-sm hover:bg-amber-50/40">
                    <span className="min-w-[12rem] flex-1 font-medium text-slate-900">{customer.name}</span>
                    <span className="w-36 text-slate-600">{customer.phone || '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-500">{customer.address || customer.email || ''}</span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length > limit && <div className="p-3 text-center"><Button variant="ghost" onClick={() => setLimit(limit + 200)}>Mostra altri ({filtered.length - limit})</Button></div>}
          </>
        )}
      </Card>
      {creating && (
        <Modal open onClose={() => setCreating(false)} title="Nuovo cliente" footer={<>
          <Button variant="secondary" onClick={() => setCreating(false)}>Annulla</Button>
          <Button onClick={create} loading={busy}>Crea cliente</Button>
        </>}>
          <CustomerForm value={draft} onChange={setDraft} />
        </Modal>
      )}
      {open && <CustomerDrawer customer={open} onClose={() => { setOpenId(null); if (params.id) navigate('clienti') }} />}
    </div>
  )
}
