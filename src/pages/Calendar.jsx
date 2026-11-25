import { useCallback, useEffect, useRef, useState } from 'react'
import { api, qs } from '../lib/api'
import { useAuth } from '../lib/auth'
import { INTERVENTION_TYPES } from '../lib/domain'
import { useShared } from '../lib/hooks'
import { Button, Card, ErrorBox, Modal, Select, cx, useToast } from '../components/ui'
import { InterventionDrawer, NewInterventionModal } from './Interventions'

const TYPE_COLORS = { chiamata: '#0284c7', riparazione: '#7c3aed', ordine_ricambi: '#d97706', preventivo: '#059669' }
const DEFAULT_MINUTES = 60

export default function CalendarPage() {
  const { user, canEdit } = useAuth()
  const { operators, operatorName } = useShared()
  const { toast } = useToast()
  const host = useRef(null)
  const calendar = useRef(null)
  const [range, setRange] = useState(null)
  const [types, setTypes] = useState(Object.keys(INTERVENTION_TYPES))
  const [operator, setOperator] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [openItem, setOpenItem] = useState(null)
  const [newSlot, setNewSlot] = useState(null)
  // FullCalendar viene caricato solo quando si apre il calendario (bundle separato).
  const [lib, setLib] = useState(null)
  const [libError, setLibError] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([import('fullcalendar'), import('@fullcalendar/core/locales/it')])
      .then(([fc, it]) => { if (active) setLib({ Calendar: fc.Calendar, locale: it.default }) })
      .catch(() => { if (active) setLibError(true) })
    return () => { active = false }
  }, [])

  const load = useCallback(async () => {
    if (!range) return
    setError(null)
    try {
      const [interventions, items] = await Promise.all([
        api.get(`/api/interventions${qs({ from: range.start, to: range.end, light: 1, take: 500, sort: 'openedAt', order: 'asc', assignedToId: operator === 'me' ? user.id : operator })}`),
        api.get(`/api/calendar${qs({ from: range.start, to: range.end })}`).catch(() => []),
      ])
      const fromInterventions = interventions
        .filter((item) => types.includes(item.type) && item.status !== 'annullato' && (showClosed || item.status !== 'completato'))
        .map((item) => {
          const start = new Date(item.openedAt)
          const minutes = Number(item.additionalData?.durationMinutes) || DEFAULT_MINUTES
          return {
            id: `i:${item.id}`,
            title: `${item.customerName || 'Cliente'}${item.description ? ` — ${item.description}` : ''}`,
            start,
            end: new Date(start.getTime() + minutes * 60_000),
            backgroundColor: item.status === 'completato' ? '#94a3b8' : TYPE_COLORS[item.type],
            borderColor: item.urgency === 3 ? '#dc2626' : TYPE_COLORS[item.type],
            editable: canEdit,
            extendedProps: { kind: 'intervention', id: item.id, operator: operatorName(item.assignedToId) },
          }
        })
      // Eventi del calendario (appuntamenti liberi, eventi importati da Google Calendar)
      const fromItems = (items || []).filter((item) => !item.interventionId).map((item) => ({
        id: `c:${item.id}`,
        title: item.title,
        start: item.startAt,
        end: item.endAt,
        allDay: Boolean(item.allDay),
        backgroundColor: '#e2e8f0',
        borderColor: '#64748b',
        textColor: '#0f172a',
        editable: canEdit && item.source !== 'google_readonly',
        extendedProps: { kind: 'calendar', item },
      }))
      setEvents([...fromInterventions, ...fromItems])
    } catch (err) {
      setError(err)
    }
  }, [range, types, operator, showClosed, user.id, canEdit, operatorName])

  useEffect(() => { load() }, [load])

  const move = useCallback(async (info) => {
    const { kind, id, item } = info.event.extendedProps
    try {
      if (kind === 'intervention') {
        const minutes = Math.max(15, Math.round((info.event.end - info.event.start) / 60_000) || DEFAULT_MINUTES)
        const current = await api.get(`/api/interventions/${id}`)
        await api.patch(`/api/interventions/${id}`, { openedAt: info.event.start.toISOString(), additionalData: { ...current.additionalData, durationMinutes: minutes } })
      } else {
        await api.patch(`/api/calendar/${item.id}`, { startAt: info.event.start.toISOString(), endAt: (info.event.end || info.event.start).toISOString() })
      }
      toast('Appuntamento spostato.')
    } catch (err) {
      info.revert()
      toast(err.message, 'error')
    }
  }, [toast])

  useEffect(() => {
    if (!lib || !host.current) return undefined
    const instance = new lib.Calendar(host.current, {
      locale: lib.locale,
      firstDay: 1,
      initialView: window.innerWidth < 768 ? 'listWeek' : 'timeGridWeek',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' },
      buttonText: { today: 'Oggi', month: 'Mese', week: 'Settimana', day: 'Giorno', list: 'Elenco' },
      slotMinTime: '07:00:00',
      slotMaxTime: '21:00:00',
      allDayText: 'Tutto il giorno',
      nowIndicator: true,
      height: 'auto',
      selectable: canEdit,
      editable: canEdit,
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      datesSet: (info) => setRange({ start: info.start.toISOString(), end: info.end.toISOString() }),
      eventClick: (info) => {
        const { kind, id, item } = info.event.extendedProps
        if (kind === 'intervention') setOpenId(id)
        else setOpenItem(item)
      },
      select: (info) => setNewSlot(info.start),
      eventDrop: move,
      eventResize: move,
      eventDidMount: (info) => {
        if (info.event.extendedProps.operator) info.el.title = `${info.event.title}\nAssegnato a ${info.event.extendedProps.operator}`
      },
    })
    instance.render()
    calendar.current = instance
    return () => { instance.destroy(); calendar.current = null }
  }, [lib, canEdit, move])

  useEffect(() => {
    if (!calendar.current) return
    calendar.current.removeAllEvents()
    calendar.current.addEventSource(events)
  }, [events])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendario</h1>
          <p className="text-sm text-slate-500">Trascina un appuntamento per spostarlo; clicca su uno spazio vuoto per crearne uno.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(INTERVENTION_TYPES).map(([type, meta]) => (
            <button key={type} type="button" onClick={() => setTypes((list) => (list.includes(type) ? list.filter((t) => t !== type) : [...list, type]))}
              className={cx('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', types.includes(type) ? 'border-slate-300 bg-white' : 'border-transparent bg-slate-100 text-slate-400 line-through')}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[type] }} />{meta.label}
            </button>
          ))}
          <Select aria-label="Operatore" value={operator} onChange={(e) => setOperator(e.target.value)} className="w-44">
            <option value="">Tutti gli operatori</option>
            <option value="me">Solo i miei</option>
            {operators.filter((op) => op.id !== user.id).map((op) => <option key={op.id} value={op.id}>{op.email.split('@')[0]}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> mostra completati</label>
        </div>
      </div>
      <ErrorBox error={error} onRetry={load} />
      <Card className="p-3">
        {libError ? <p className="p-6 text-sm text-slate-500">Il calendario non si è caricato. Ricarica la pagina.</p> : <div ref={host}>{!lib && <p className="p-6 text-sm text-slate-500">Caricamento calendario…</p>}</div>}
      </Card>
      {openId && <InterventionDrawer id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {newSlot && <NewSlotChooser start={newSlot} onClose={() => setNewSlot(null)} onCreated={() => { setNewSlot(null); load() }} />}
      {openItem && (
        <Modal open size="sm" onClose={() => setOpenItem(null)} title={openItem.title} footer={<Button variant="secondary" onClick={() => setOpenItem(null)}>Chiudi</Button>}>
          <p className="text-sm text-slate-600">{new Date(openItem.startAt).toLocaleString('it-IT')} – {new Date(openItem.endAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>
          {openItem.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{openItem.description}</p>}
          {openItem.location && <p className="mt-2 text-sm text-slate-600">📍 {openItem.location}</p>}
          {openItem.source === 'google' && <p className="mt-2 text-xs text-slate-500">Evento importato da Google Calendar: le modifiche fatte su Google arrivano qui in pochi minuti.</p>}
        </Modal>
      )}
    </div>
  )
}

function NewSlotChooser({ start, onClose, onCreated }) {
  const [type, setType] = useState(null)
  if (type) return <NewInterventionModal type={type} defaults={{ openedAt: start }} onClose={onClose} onCreated={onCreated} />
  return (
    <Modal open size="sm" onClose={onClose} title={`Nuovo appuntamento — ${start.toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`}>
      <div className="grid gap-2">
        {Object.entries(INTERVENTION_TYPES).map(([key, meta]) => (
          <Button key={key} variant="secondary" className="!justify-start" onClick={() => setType(key)}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[key] }} /> {meta.singular}
          </Button>
        ))}
      </div>
    </Modal>
  )
}
