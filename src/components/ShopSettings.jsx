import { useState } from 'react'
import { ImageUp, Store } from 'lucide-react'
import { api } from '../lib/api'
import { uploadFile } from '../lib/files'
import { useAsync } from '../lib/hooks'
import { Button, Card, ErrorBox, Input, Spinner, Textarea, useToast } from './ui'

// Dati del negozio stampati sui rapportini (e, più avanti, sulle pagine di stato per i clienti).
export default function ShopSettings() {
  const profile = useAsync(() => api.get('/api/shop-profile'), [])
  if (profile.error) return <ErrorBox error={profile.error} onRetry={profile.reload} />
  if (!profile.data) return <Spinner />
  return <ShopForm initial={profile.data} onSaved={profile.setData} />
}

function ShopForm({ initial, onSaved }) {
  const { toast } = useToast()
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState('')
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const save = async (patch = {}) => {
    setBusy('save')
    try {
      const saved = await api.put('/api/shop-profile', { ...form, ...patch })
      setForm(saved)
      onSaved(saved)
      toast('Dati del negozio salvati.')
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }

  const uploadLogo = async (file) => {
    if (!file) return
    setBusy('logo')
    try {
      const saved = await uploadFile(file, { kind: 'logo' })
      await save({ logoFileId: saved.id })
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Store className="h-4 w-4" /> Dati stampati sui rapportini</div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {form.logoFileId ? <img src={`/api/files/${form.logoFileId}`} alt="Logo del negozio" className="max-h-16 max-w-32 object-contain" /> : <span className="text-xs text-slate-400">Nessun logo</span>}
        </div>
        <label className="cursor-pointer">
          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
          <span className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><ImageUp className="h-4 w-4" /> {busy === 'logo' ? 'Caricamento…' : 'Carica logo (PNG/JPG)'}</span>
        </label>
        {form.logoFileId && <Button size="sm" variant="ghost" onClick={() => save({ logoFileId: null })}>Rimuovi</Button>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Nome del negozio" value={form.name} onChange={set('name')} placeholder="Es. Elettrodomestici Rossi" />
        <Input label="Partita IVA" value={form.vatNumber} onChange={set('vatNumber')} />
        <Input label="Indirizzo" value={form.address} onChange={set('address')} className="sm:col-span-2" />
        <Input label="Telefono" value={form.phone} onChange={set('phone')} />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} />
        <Input label="Tariffa oraria manodopera €" type="number" min="0" step="0.5" value={form.hourlyRate} onChange={set('hourlyRate')} hint="Proposta in automatico nel rapportino." />
        <Input label="Diritto di chiamata €" type="number" min="0" step="0.5" value={form.callFee} onChange={set('callFee')} hint="Solo per gli interventi a domicilio." />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.pricesIncludeVat !== false} onChange={set('pricesIncludeVat')} className="h-4 w-4 rounded border-slate-300" />
        I prezzi sono IVA inclusa
      </label>
      <Textarea label="Testo a piè di pagina" rows={2} value={form.footer} onChange={set('footer')} placeholder="Documento non fiscale. Garanzia sulla riparazione: …" />
      <div className="flex justify-end"><Button onClick={() => save()} loading={busy === 'save'}>Salva</Button></div>
    </Card>
  )
}
