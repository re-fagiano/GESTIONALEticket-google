import { useState } from 'react'
import { AlertTriangle, Boxes, CalendarDays, CloudOff, Plus } from 'lucide-react'
import { api, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { INTERVENTION_TYPES, STATUSES } from '../lib/domain'
import { fmtDateTime, fmtTime } from '../lib/format'
import { navigate, useAsync, useShared } from '../lib/hooks'
import { Badge, Button, Card, EmptyState, Spinner, Stat } from '../components/ui'

const startOfDay = (offset = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toISOString() }

function List({ state, empty, operatorName }) {
  return (state.loading && !state.data ? <Spinner /> : (state.data || []).length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p> : (
    <ul className="divide-y divide-slate-100">
      {state.data.map((item) => (
        <li key={item.id}>
          <a href={`#/${INTERVENTION_TYPES[item.type].route}?id=${item.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-amber-50/40">
            <span className="w-12 shrink-0 font-mono text-xs text-slate-500">{fmtTime(item.openedAt)}</span>
            <Badge className={INTERVENTION_TYPES[item.type].color}>{INTERVENTION_TYPES[item.type].singular}</Badge>
            <span className="min-w-0 flex-1 truncate"><b>{item.customerName}</b>{item.description ? ` — ${item.description}` : ''}</span>
            <Badge className={STATUSES[item.status]?.color}>{STATUSES[item.status]?.label}</Badge>
            {item.assignedToId && <span className="hidden text-xs text-slate-500 sm:inline">{operatorName(item.assignedToId)}</span>}
          </a>
        </li>
      ))}
    </ul>
  ))
}

export default function Dashboard() {
  const { user, isAdmin, canEdit } = useAuth()
  const { operatorName } = useShared()
  const stats = useAsync(() => api.get('/api/interventions/stats'), [])
  const today = useAsync(() => api.get(`/api/interventions${qs({ from: startOfDay(0), to: startOfDay(1), light: 1, take: 100, sort: 'openedAt', order: 'asc' })}`), [])
  const urgent = useAsync(() => api.get(`/api/interventions${qs({ open: 1, urgency: 3, light: 1, take: 10, sort: 'openedAt', order: 'asc' })}`), [])
  const mine = useAsync(() => api.get(`/api/interventions${qs({ open: 1, assignedToId: user.id, light: 1, take: 10, sort: 'openedAt', order: 'asc' })}`), [user.id])
  const stock = useAsync(() => api.get('/api/inventory/summary'), [])
  const lowStock = useAsync(() => api.get(`/api/inventory${qs({ stock: 'low', take: 8, sort: 'qty', order: 'asc' })}`), [])
  const backup = useAsync(() => (isAdmin ? api.get('/api/admin/backup/latest') : Promise.resolve(null)), [isAdmin])

  const [now] = useState(() => Date.now())
  const last = backup.data?.lastRun
  const backupProblem = isAdmin && backup.data !== undefined && (!last || last.status !== 'success' || now - new Date(last.created_at).getTime() > 36 * 3600_000)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Buongiorno, {user.email.split('@')[0]}</h1>
          <p className="text-sm text-slate-500">{new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button icon={Plus} onClick={() => navigate('chiamate', { new: 1 })}>Nuova chiamata</Button>
            <Button variant="secondary" icon={Plus} onClick={() => navigate('riparazioni', { new: 1 })}>Nuova riparazione</Button>
          </div>
        )}
      </div>

      {backupProblem && (
        <a href="#/impostazioni?tab=backup" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <CloudOff className="mt-0.5 h-5 w-5 shrink-0" />
          <span><b>Backup non attivo.</b> {last?.error_message || 'Nessun backup riuscito nelle ultime 36 ore.'} Apri le impostazioni per sistemarlo.</span>
        </a>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(INTERVENTION_TYPES).map(([type, meta]) => (
          <Stat key={type} label={meta.label} value={stats.data?.[type]?.open ?? (stats.loading ? '…' : 0)} hint={stats.data?.[type]?.urgent ? `${stats.data[type].urgent} urgenti` : 'aperte'}
            tone={stats.data?.[type]?.urgent ? 'danger' : 'default'} onClick={() => navigate(meta.route)} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800"><CalendarDays className="h-4 w-4" /> Oggi</h2>
            <a href="#/calendario" className="text-sm text-slate-500 hover:text-slate-900">Calendario →</a>
          </div>
          <List operatorName={operatorName} state={today} empty="Nessun appuntamento oggi." />
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800"><Boxes className="h-4 w-4" /> Magazzino</h2>
            <a href="#/magazzino" className="text-sm text-slate-500 hover:text-slate-900">Apri →</a>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            <Stat label="Sotto scorta" value={stock.data?.lowStock ?? '…'} tone={stock.data?.lowStock ? 'warn' : 'default'} onClick={() => navigate('magazzino', { stock: 'low' })} />
            <Stat label="Esauriti" value={stock.data?.outOfStock ?? '…'} tone={stock.data?.outOfStock ? 'danger' : 'default'} onClick={() => navigate('magazzino', { stock: 'out' })} />
          </div>
          {(lowStock.data || []).length > 0 && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
              {lowStock.data.map((item) => (
                <li key={item.id}><a href={`#/magazzino?id=${item.id}`} className="flex justify-between gap-2 px-4 py-2 hover:bg-slate-50"><span className="truncate"><span className="font-mono text-xs">{item.code}</span> {item.name}</span><span className="shrink-0 font-semibold text-amber-600">{item.qty}/{item.minQty}</span></a></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-red-500" /> Urgenti aperte</h2>
          <List operatorName={operatorName} state={urgent} empty="Nessuna urgenza aperta. 👍" />
        </Card>
        <Card>
          <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-800">Assegnate a me</h2>
          {(mine.data || []).length === 0 && !mine.loading ? <EmptyState title="Niente in coda" /> : <List operatorName={operatorName} state={mine} empty="" />}
        </Card>
      </div>
      {today.data && today.data.length > 0 && <p className="text-center text-xs text-slate-400">Aggiornato {fmtDateTime(new Date())}</p>}
    </div>
  )
}
