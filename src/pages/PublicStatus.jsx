import { useEffect, useState } from 'react'
import { CalendarClock, Check, FileText, MapPin, MessageCircle, Phone, XCircle } from 'lucide-react'
import { normalizePhone } from '../lib/messages'

// Pagina pubblica per il cliente (/s/<token>): nessun login, si aggiorna da sola ogni minuto.
const fmt = (value, opts) => (value ? new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome', ...opts }) : '')
const when = (value) => fmt(value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const euro = (value) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0)

export default function PublicStatus() {
  const token = window.location.pathname.split('/')[2] || ''
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    let alive = true
    const load = () => fetch(`/api/public/status/${encodeURIComponent(token)}`)
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => null) }))
      .then(({ ok, body }) => { if (alive) setState(ok ? { data: body } : { error: body?.error || 'Link non valido.' }) })
      .catch(() => { if (alive) setState((prev) => (prev.data ? prev : { error: 'Connessione non disponibile. Riprova tra poco.' })) })
    load()
    const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [token])

  useEffect(() => {
    if (state.data) document.title = `${state.data.typeLabel} ${state.data.code}${state.data.shop.name ? ` · ${state.data.shop.name}` : ''}`
  }, [state.data])

  if (state.loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Caricamento…</div>
  if (state.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow">
          <XCircle className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-slate-700">{state.error}</p>
        </div>
      </div>
    )
  }

  const d = state.data
  const phone = normalizePhone(d.shop.phone)
  const current = d.steps.find((s) => s.current) || [...d.steps].reverse().find((s) => s.done)
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 px-5 pb-16 pt-6 text-white">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {d.shop.hasLogo && <img src={`/api/public/status/${token}/logo`} alt="" className="h-10 w-10 rounded bg-white object-contain p-1" />}
          <div className="text-lg font-semibold">{d.shop.name || 'Assistenza elettrodomestici'}</div>
        </div>
      </header>
      <main className="mx-auto -mt-12 max-w-lg space-y-4 px-4 pb-10">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500">{d.typeLabel} · rif. {d.code}</div>
          {d.appliance && <div className="mt-1 text-lg font-semibold text-slate-900">{d.appliance}</div>}
          <div className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${d.cancelled ? 'bg-red-100 text-red-700' : current?.done && !d.steps.some((s) => s.current) ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
            {d.cancelled ? 'Annullato' : current?.label}
          </div>
          <div className="mt-1 text-xs text-slate-400">Aggiornato {when(d.updatedAt)}</div>
        </section>

        {d.appointmentAt && (
          <section className="flex items-center gap-3 rounded-2xl bg-white p-5 shadow-sm">
            <CalendarClock className="h-8 w-8 text-amber-500" />
            <div>
              <div className="text-sm text-slate-500">Appuntamento con il tecnico</div>
              <div className="font-semibold capitalize text-slate-900">{fmt(d.appointmentAt, { weekday: 'long', day: 'numeric', month: 'long' })}, ore {fmt(d.appointmentAt, { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </section>
        )}

        {!d.cancelled && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <ol className="space-y-0">
              {d.steps.map((step, i) => (
                <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
                  {i < d.steps.length - 1 && <span className={`absolute left-[11px] top-6 h-full w-0.5 ${step.done ? 'bg-green-500' : 'bg-slate-200'}`} />}
                  <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${step.done ? 'bg-green-500 text-white' : step.current ? 'bg-amber-400 ring-4 ring-amber-100' : 'bg-slate-200'}`}>
                    {step.done && <Check className="h-4 w-4" />}
                  </span>
                  <div>
                    <div className={`text-sm ${step.done || step.current ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>{step.label}</div>
                    {step.at && (step.done || step.current) && <div className="text-xs text-slate-500">{when(step.at)}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {d.quote && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Preventivo</div>
            {d.quote.items && <p className="mt-1 whitespace-pre-line text-slate-800">{d.quote.items}</p>}
            {d.quote.total > 0 && <div className="mt-2 text-2xl font-bold text-slate-900">{euro(d.quote.total)}</div>}
            {d.quote.validUntil && <div className="text-xs text-slate-500">Valido fino al {fmt(d.quote.validUntil, { day: 'numeric', month: 'long', year: 'numeric' })}</div>}
          </section>
        )}

        {d.report && (
          <a href={`/api/public/status/${token}/report.pdf`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-white p-5 shadow-sm hover:bg-amber-50">
            <FileText className="h-8 w-8 text-slate-700" />
            <div className="flex-1">
              <div className="font-semibold text-slate-900">Rapportino n. {d.report.number}</div>
              <div className="text-sm text-slate-500">Totale {euro(d.report.total)} · scarica il PDF</div>
            </div>
          </a>
        )}

        {(phone || d.shop.address) && (
          <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Hai domande?</div>
            <div className="grid grid-cols-2 gap-2">
              {phone && <a href={`tel:+${phone}`} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 py-2.5 text-sm font-medium text-slate-800"><Phone className="h-4 w-4" /> Chiama</a>}
              {phone && <a href={`https://wa.me/${phone}?text=${encodeURIComponent(`Buongiorno, vi scrivo per la pratica ${d.code}.`)}`} className="flex items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-sm font-medium text-white"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
            </div>
            {d.shop.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.shop.address)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4" /> {d.shop.address}</a>}
          </section>
        )}
      </main>
    </div>
  )
}
