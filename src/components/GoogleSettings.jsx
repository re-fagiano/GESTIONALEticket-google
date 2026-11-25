import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Copy, Link2, RefreshCw, Unlink } from 'lucide-react'
import { api } from '../lib/api'
import { INTERVENTION_TYPES } from '../lib/domain'
import { fmtDateTime } from '../lib/format'
import { useAsync, useRoute } from '../lib/hooks'
import { Badge, Button, Card, ErrorBox, Input, Select, Spinner, useToast } from './ui'

const CALLBACK_ERRORS = {
  state_non_valido: 'Collegamento scaduto o non valido: riprova.',
  refresh_token_mancante: "Google non ha concesso l'accesso permanente. Rimuovi l'app da myaccount.google.com/permissions e riprova.",
  scambio_codice_fallito: 'Google ha rifiutato il collegamento. Controlla Client ID/Secret e URI di reindirizzamento.',
  access_denied: 'Accesso negato su Google.',
}

function SetupHelp({ redirectUri }) {
  const { toast } = useToast()
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
      <p className="font-medium">Configurazione una tantum (Google Cloud + Railway)</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Su <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">console.cloud.google.com</a> crea un progetto e abilita <b>Google Calendar API</b> e <b>Google Drive API</b>.</li>
        <li>Schermata di consenso OAuth: tipo <b>Esterno</b>, aggiungi il tuo indirizzo Gmail come utente di test, poi <b>Pubblica l&apos;app</b> (altrimenti il collegamento scade dopo 7 giorni).</li>
        <li>Credenziali → <b>ID client OAuth</b> → Applicazione web, con URI di reindirizzamento autorizzato:
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 text-xs">{redirectUri}</code>
            <Button size="sm" variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(redirectUri).then(() => toast('Copiato.'))}>Copia</Button>
          </div>
        </li>
        <li>Su Railway, nelle variabili del servizio, aggiungi <code>GOOGLE_OAUTH_CLIENT_ID</code> e <code>GOOGLE_OAUTH_CLIENT_SECRET</code>, poi torna qui e premi &quot;Collega account Google&quot;.</li>
      </ol>
    </div>
  )
}

export default function GoogleSettings() {
  const { toast } = useToast()
  const route = useRoute()
  const status = useAsync(() => api.get('/api/google/status'), [])
  const connected = status.data && status.data.mode !== 'none'
  const calendars = useAsync(() => (connected ? api.get('/api/google/calendars') : Promise.resolve([])), [connected])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState('')
  const [shownParam, setShownParam] = useState('')

  useEffect(() => {
    if (status.data?.calendar?.settings) setForm(status.data.calendar.settings)
  }, [status.data])

  const paramKey = route.params.connected || route.params.error || ''
  if (paramKey && paramKey !== shownParam) {
    setShownParam(paramKey)
    if (route.params.connected) toast('Account Google collegato.')
    else toast(CALLBACK_ERRORS[route.params.error] || `Collegamento non riuscito (${route.params.error}).`, 'error')
  }

  const connect = async () => {
    setBusy('connect')
    try {
      await api.post('/api/auth/refresh').catch(() => {}) // sessione fresca prima di andare su Google
      const { url } = await api.get('/api/google/connect')
      window.location.href = url
    } catch (error) {
      toast(error.message, 'error')
      setBusy('')
    }
  }

  const disconnect = async () => {
    setBusy('disconnect')
    try { await api.post('/api/google/disconnect'); toast('Account Google scollegato.'); status.reload() } catch (error) { toast(error.message, 'error') } finally { setBusy('') }
  }

  const save = async () => {
    setBusy('save')
    try {
      const saved = await api.put('/api/google/calendar/settings', form)
      setForm(saved)
      toast(saved.enabled ? 'Impostazioni salvate: sincronizzazione avviata.' : 'Impostazioni salvate.')
      setTimeout(() => status.reload(), 3000)
    } catch (error) { toast(error.message, 'error') } finally { setBusy('') }
  }

  const syncNow = async (recreateDeleted = false) => {
    setBusy('sync')
    try {
      const report = await api.post('/api/google/calendar/sync', { recreateDeleted })
      if (report.skipped) toast(report.skipped === 'disabled' ? 'Attiva prima la sincronizzazione.' : 'Collega prima Google.', 'info')
      else toast(`Sincronizzato: ${report.pushed.created} creati, ${report.pushed.updated} aggiornati su Google · ${report.pulled?.movedInterventions || 0} spostati e ${report.pulled?.importedEvents || 0} importati da Google.`)
      status.reload()
    } catch (error) { toast(error.message, 'error') } finally { setBusy('') }
  }

  if (status.loading && !status.data) return <Spinner />
  if (status.error) return <ErrorBox error={status.error} onRetry={status.reload} />
  const s = status.data
  const cal = s.calendar
  const dirty = form && JSON.stringify(form) !== JSON.stringify(cal.settings)

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h3 className="flex items-center gap-2 font-semibold"><Link2 className="h-5 w-5" /> Account Google</h3>
        {connected ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span>
              {s.mode === 'oauth' ? <>Collegato come <b>{s.account?.email || 'account Google'}</b>{s.account?.connectedAt ? ` dal ${fmtDateTime(s.account.connectedAt)}` : ''}</> : <>Service account <b>{s.serviceAccountEmail}</b></>}
            </span>
            {s.mode === 'oauth' && <Button size="sm" variant="dangerGhost" icon={Unlink} onClick={disconnect} loading={busy === 'disconnect'} className="ml-auto">Scollega</Button>}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Collega l&apos;account Google del negozio per sincronizzare il calendario e salvare i backup su Google Drive.</p>
            {s.oauthClientConfigured
              ? <Button icon={Link2} onClick={connect} loading={busy === 'connect'}>Collega account Google</Button>
              : <SetupHelp redirectUri={s.redirectUri} />}
          </div>
        )}
        {s.mode === 'service_account' && s.oauthClientConfigured && <Button size="sm" variant="secondary" onClick={connect}>Usa invece l&apos;account Google del negozio</Button>}
      </Card>

      {connected && form && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="flex items-center gap-2 font-semibold"><CalendarDays className="h-5 w-5" /> Ponte con Google Calendar</h3>
            <Badge className={cal.settings.enabled ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}>{cal.settings.enabled ? 'Attivo' : 'Spento'}</Badge>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Sincronizza gli appuntamenti con Google Calendar
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Calendario Google" value={form.calendarId} onChange={(e) => setForm({ ...form, calendarId: e.target.value })}>
              {!calendars.data?.some((c) => c.id === form.calendarId) && <option value={form.calendarId}>{form.calendarId === 'primary' ? 'Calendario principale' : form.calendarId}</option>}
              {(calendars.data || []).map((c) => <option key={c.id} value={c.primary ? 'primary' : c.id}>{c.summary}{c.primary ? ' (principale)' : ''}</option>)}
            </Select>
            <Input label="Durata predefinita appuntamento (minuti)" type="number" min="5" max="600" value={form.defaultMinutes} onChange={(e) => setForm({ ...form, defaultMinutes: Number(e.target.value) })} />
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Cosa mandare su Google</div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(INTERVENTION_TYPES).map(([type, meta]) => (
                <label key={type} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={form.pushTypes.includes(type)} onChange={(e) => setForm({ ...form, pushTypes: e.target.checked ? [...form.pushTypes, type] : form.pushTypes.filter((t) => t !== type) })} /> {meta.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">Ogni appuntamento diventa un evento con cliente, telefono, indirizzo (cliccabile per il navigatore) e link alla scheda. Spostamenti, completamenti e annullamenti si aggiornano da soli.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.importEvents} onChange={(e) => setForm({ ...form, importEvents: e.target.checked })} /> Mostra nel calendario del gestionale anche gli eventi creati direttamente su Google
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} loading={busy === 'save'} disabled={!dirty}>Salva</Button>
            <Button variant="secondary" icon={RefreshCw} onClick={() => syncNow(false)} loading={busy === 'sync'} disabled={!cal.settings.enabled}>Sincronizza ora</Button>
          </div>
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <div>Ultima sincronizzazione completa: <b>{fmtDateTime(cal.state.lastSyncAt)}</b> · ultima lettura da Google: <b>{fmtDateTime(cal.state.lastPullAt)}</b> (automatica ogni 5 minuti)</div>
            <div>Collegati: {cal.links.interventions} appuntamenti, {cal.links.events} eventi Google</div>
            {cal.links.deletedInGoogle > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {cal.links.deletedInGoogle} eventi eliminati a mano su Google (non vengono ricreati).
                <button type="button" className="underline" onClick={() => syncNow(true)}>Ricreali</button>
              </div>
            )}
            {cal.state.lastError && <div className="text-red-700">Ultimo errore: {cal.state.lastError}</div>}
          </div>
        </Card>
      )}
    </div>
  )
}
