import { useMemo, useState } from 'react'
import { Plus, Search, UserRound } from 'lucide-react'
import { api } from '../lib/api'
import { useShared } from '../lib/hooks'
import { newId } from '../lib/format'
import { Button, Input, cx, useToast } from './ui'

// Selettore cliente con ricerca (nome, telefono, email, indirizzo) e creazione rapida in linea.
export default function CustomerPicker({ value, onChange, label = 'Cliente *' }) {
  const { customers, customerById, upsertCustomer } = useShared()
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', phone: '', address: '', email: '' })
  const [busy, setBusy] = useState(false)
  const selected = value ? customerById(value) : null

  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const pool = terms.length
      ? customers.filter((c) => terms.every((t) => [c.name, c.phone, c.email, c.address].some((field) => String(field || '').toLowerCase().includes(t))))
      : customers
    return pool.slice(0, 12)
  }, [customers, query])

  const create = async () => {
    if (!draft.name.trim()) return toast('Inserisci il nome del cliente.', 'error')
    setBusy(true)
    try {
      const created = await api.post('/api/customers', { ...draft, id: newId() })
      upsertCustomer(created)
      onChange(created.id)
      setCreating(false)
      setOpen(false)
      setDraft({ name: '', phone: '', address: '', email: '' })
      toast('Cliente creato.')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
        <div className="text-sm font-medium text-slate-700">Nuovo cliente</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Nome e cognome / ragione sociale *" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          <Input placeholder="Telefono" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <Input placeholder="Indirizzo" className="sm:col-span-2" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          <Input placeholder="Email" type="email" className="sm:col-span-2" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={create} loading={busy}>Salva cliente</Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Annulla</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="mb-1 text-sm font-medium text-slate-700">{label}</div>
      {selected && !open ? (
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-amber-400">
          <UserRound className="h-4 w-4 text-slate-400" />
          <span className="flex-1"><b>{selected.name}</b>{selected.phone ? ` · ${selected.phone}` : ''}{selected.address ? <span className="block text-xs text-slate-500">{selected.address}</span> : null}</span>
          <span className="text-xs text-slate-500">cambia</span>
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            autoFocus={open}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
            placeholder="Cerca per nome, telefono, indirizzo…"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            aria-label="Cerca cliente"
          />
        </div>
      )}
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {matches.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className={cx('block w-full px-3 py-2 text-left text-sm hover:bg-amber-50', customer.id === value && 'bg-amber-50')}
              onClick={() => { onChange(customer.id); setOpen(false); setQuery('') }}
            >
              <b>{customer.name}</b>{customer.phone ? ` · ${customer.phone}` : ''}
              {customer.address && <span className="block truncate text-xs text-slate-500">{customer.address}</span>}
            </button>
          ))}
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Nessun cliente trovato.</div>}
          <div className="flex gap-2 border-t border-slate-100 p-2">
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => { setCreating(true); setDraft((d) => ({ ...d, name: /\d{6,}/.test(query) ? '' : query, phone: /\d{6,}/.test(query) ? query : '' })) }}>Nuovo cliente</Button>
            {selected && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Chiudi</Button>}
          </div>
        </div>
      )}
    </div>
  )
}
