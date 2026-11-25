import { useState } from 'react'
import { CheckCircle2, CloudOff, Download, HardDriveDownload, KeyRound, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { api, download } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ROLES } from '../lib/domain'
import { fmtDateTime } from '../lib/format'
import { navigate, useAsync, useShared } from '../lib/hooks'
import { scanLegacyData, uploadLegacyData } from '../lib/legacyRecovery'
import { Badge, Button, Card, ErrorBox, Select, Spinner, Tabs, useToast } from '../components/ui'
import GoogleSettings from '../components/GoogleSettings'
import ShopSettings from '../components/ShopSettings'

const BACKUP_STATUS = {
  success: { label: 'Riuscito', className: 'bg-green-100 text-green-800' },
  not_configured: { label: 'Google non collegato: backup NON salvato', className: 'bg-amber-100 text-amber-800' },
  degraded: { label: 'Non salvato (vecchio stato "degraded")', className: 'bg-amber-100 text-amber-800' },
  failed: { label: 'Fallito', className: 'bg-red-100 text-red-700' },
}

function Profile() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [code, setCode] = useState(user.operatorCode)
  const regenerate = async () => {
    try {
      const res = await api.post('/api/auth/operator-code/regenerate')
      setCode(res.operatorCode)
      toast('Nuovo codice operatore generato.')
    } catch (error) { toast(error.message, 'error') }
  }
  return (
    <Card className="space-y-3 p-5">
      <div className="text-sm text-slate-600">Accesso come <b>{user.email}</b> · {ROLES[user.role]}</div>
      <div className="flex items-center gap-3">
        <KeyRound className="h-5 w-5 text-slate-400" />
        <span className="text-sm">Codice operatore: <b className="font-mono">{code}</b></span>
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={regenerate}>Rigenera</Button>
      </div>
      <p className="text-xs text-slate-500">Il codice firma le note che scrivi sugli interventi.</p>
    </Card>
  )
}

function UsersAdmin() {
  const { user } = useAuth()
  const { toast } = useToast()
  const users = useAsync(() => api.get('/api/admin/users'), [])
  const update = async (target, patch) => {
    try {
      const { user: updated } = await api.patch(`/api/admin/users/${target.id}`, { role: target.role, approved: target.approved, status: target.status, ...patch })
      users.setData((prev) => ({ users: prev.users.map((u) => (u.id === updated.id ? updated : u)) }))
      toast('Utente aggiornato.')
    } catch (error) { toast(error.message, 'error') }
  }
  if (users.loading && !users.data) return <Spinner />
  const list = users.data?.users || []
  const pending = list.filter((u) => !u.approved && u.status !== 'disabled')
  return (
    <div className="space-y-4">
      <ErrorBox error={users.error} onRetry={users.reload} />
      {pending.length > 0 && (
        <Card className="border-amber-300 p-4">
          <h3 className="mb-2 text-sm font-semibold">Richieste di accesso ({pending.length})</h3>
          {pending.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
              <span className="flex-1">{u.email} · {fmtDateTime(u.createdAt)}</span>
              <Button size="sm" onClick={() => update(u, { approved: true, status: 'active', role: 'OPERATOR' })}>Approva come operatore</Button>
              <Button size="sm" variant="ghost" onClick={() => update(u, { approved: false, status: 'disabled' })}>Rifiuta</Button>
            </div>
          ))}
        </Card>
      )}
      <Card>
        <ul className="divide-y divide-slate-100">
          {list.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-[14rem] flex-1">
                <div className="font-medium">{u.email} {u.id === user.id && <Badge className="bg-sky-100 text-sky-800">tu</Badge>}</div>
                <div className="text-xs text-slate-500">{u.operatorCode} · creato {fmtDateTime(u.createdAt)}</div>
              </div>
              <Badge className={u.status === 'disabled' ? 'bg-red-100 text-red-700' : u.approved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                {u.status === 'disabled' ? 'Disabilitato' : u.approved ? 'Attivo' : 'In attesa'}
              </Badge>
              <Select aria-label={`Ruolo di ${u.email}`} value={u.role} disabled={u.id === user.id} onChange={(e) => update(u, { role: e.target.value })} className="w-40">
                {Object.entries(ROLES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
              {u.id !== user.id && (u.status === 'disabled'
                ? <Button size="sm" variant="secondary" onClick={() => update(u, { approved: true, status: 'active' })}>Riattiva</Button>
                : <Button size="sm" variant="dangerGhost" onClick={() => update(u, { approved: false, status: 'disabled' })}>Disabilita</Button>)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function Backup() {
  const { toast } = useToast()
  const latest = useAsync(() => api.get('/api/admin/backup/latest'), [])
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const res = await api.post('/api/admin/backup')
      toast(res.message, res.result?.mode === 'drive' ? 'success' : 'info')
      latest.reload()
    } catch (error) {
      toast(error.data?.detail || error.message, 'error')
      latest.reload()
    } finally { setBusy(false) }
  }
  const last = latest.data?.lastRun
  const status = BACKUP_STATUS[last?.status] || { label: last?.status || 'Mai eseguito', className: 'bg-slate-100 text-slate-700' }
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h3 className="flex items-center gap-2 font-semibold">{last?.status === 'success' ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <CloudOff className="h-5 w-5 text-amber-600" />} Backup automatico su Google Drive</h3>
        {latest.loading && !latest.data ? <Spinner /> : (
          <div className="space-y-1 text-sm">
            <div>Ultimo: <b>{last ? fmtDateTime(last.created_at) : '—'}</b> <Badge className={status.className}>{status.label}</Badge></div>
            {last?.file_name && <div className="text-slate-500">File: {last.file_name}</div>}
            {last?.error_message && <div className="text-amber-800">{last.error_message}</div>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={run} loading={busy} icon={Upload}>Esegui backup ora</Button>
          <Button variant="secondary" icon={Download} onClick={() => download('/api/admin/export/json', 'backup.json')}>Scarica backup completo (JSON)</Button>
          <Button variant="secondary" icon={Download} onClick={() => download('/api/admin/export/csv', 'interventi.csv')}>Interventi (CSV)</Button>
          <Button variant="secondary" icon={Download} onClick={() => download('/api/inventory/export.csv', 'magazzino.csv')}>Magazzino (CSV)</Button>
        </div>
        <p className="text-xs text-slate-500">Il backup contiene clienti, interventi con note e storico, calendario, magazzino con movimenti e utenti. Per attivare il salvataggio su Drive collega l&apos;account Google nella scheda Google.</p>
      </Card>
    </div>
  )
}

function LegacyRecovery() {
  const { toast } = useToast()
  const { reloadCustomers } = useShared()
  const [scan, setScan] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try { setScan(await scanLegacyData()) } catch (error) { toast(error.message, 'error') } finally { setBusy(false) }
  }
  const upload = async () => {
    setBusy(true)
    try {
      const result = await uploadLegacyData(scan.missing)
      await reloadCustomers()
      toast(`Recuperati: ${result.customers} clienti, ${result.tickets} ticket, ${result.interventions} interventi.${result.errors.length ? ` ${result.errors.length} errori.` : ''}`, result.errors.length ? 'error' : 'success')
      setScan(await scanLegacyData())
    } finally { setBusy(false) }
  }
  const total = scan ? scan.missing.customers.length + scan.missing.tickets.length + scan.missing.interventions.length : 0
  return (
    <Card className="space-y-3 p-5">
      <h3 className="flex items-center gap-2 font-semibold"><HardDriveDownload className="h-5 w-5" /> Recupera dati dalla vecchia versione</h3>
      <p className="text-sm text-slate-600">La vecchia interfaccia teneva una copia dei dati in questo browser. Alcuni ticket esistevano solo lì. Questo controllo li confronta con il server e carica quelli mancanti. Ripetilo su ogni computer/telefono usato con la vecchia versione.</p>
      <Button variant="secondary" onClick={run} loading={busy && !scan}>Controlla questo browser</Button>
      {scan && !scan.found && <p className="text-sm text-slate-500">Nessun dato della vecchia versione in questo browser.</p>}
      {scan?.found && (total === 0
        ? <p className="flex items-center gap-2 text-sm text-green-700"><ShieldCheck className="h-4 w-4" /> Tutto già presente sul server.</p>
        : (
          <div className="space-y-2 text-sm">
            <p>Mancano sul server: <b>{scan.missing.customers.length}</b> clienti, <b>{scan.missing.tickets.length}</b> ticket, <b>{scan.missing.interventions.length}</b> interventi.</p>
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-slate-600">
              {scan.missing.tickets.slice(0, 30).map((t) => <li key={t.id}>Ticket: {t.subject}{t.date ? ` (${t.date})` : ''}</li>)}
              {scan.missing.interventions.slice(0, 30).map((i) => <li key={i.id}>Intervento {i.code || ''} {i.description?.slice(0, 60) || ''}</li>)}
              {scan.missing.customers.slice(0, 30).map((c) => <li key={c.id}>Cliente: {c.name}</li>)}
            </ul>
            <Button onClick={upload} loading={busy}>Carica sul server</Button>
          </div>
        ))}
    </Card>
  )
}

export default function SettingsPage({ params = {} }) {
  const { isAdmin } = useAuth()
  const tab = params.tab || 'profilo'
  const tabs = [
    { value: 'profilo', label: 'Profilo' },
    ...(isAdmin ? [{ value: 'negozio', label: 'Negozio' }, { value: 'utenti', label: 'Utenti' }, { value: 'backup', label: 'Backup' }, { value: 'google', label: 'Google' }] : []),
    { value: 'recupero', label: 'Recupero dati' },
  ]
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Impostazioni</h1>
      <Tabs tabs={tabs} value={tab} onChange={(value) => navigate('impostazioni', { tab: value })} />
      {tab === 'profilo' && <Profile />}
      {tab === 'negozio' && isAdmin && <ShopSettings />}
      {tab === 'utenti' && isAdmin && <UsersAdmin />}
      {tab === 'backup' && isAdmin && <Backup />}
      {tab === 'google' && isAdmin && <GoogleSettings />}
      {tab === 'recupero' && <LegacyRecovery />}
    </div>
  )
}
