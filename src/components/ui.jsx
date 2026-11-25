/* eslint-disable react-refresh/only-export-components -- libreria UI: componenti e piccoli hook insieme */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react'

const cx = (...classes) => classes.filter(Boolean).join(' ')

const BUTTON_VARIANTS = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400',
  accent: 'bg-amber-400 text-slate-900 hover:bg-amber-300 disabled:opacity-50',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:opacity-50',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:opacity-50',
  dangerGhost: 'text-red-600 hover:bg-red-50 disabled:opacity-50',
}

export function Button({ variant = 'primary', size = 'md', loading = false, icon: Icon, className, children, ...props }) {
  const sizes = { sm: 'px-2.5 py-1.5 text-sm gap-1.5', md: 'px-3.5 py-2 text-sm gap-2', lg: 'px-5 py-2.5 text-base gap-2' }
  return (
    <button
      type="button"
      className={cx('inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed', BUTTON_VARIANTS[variant], sizes[size], className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  )
}

export function Field({ label, hint, error, children, className }) {
  const id = useId()
  const child = typeof children === 'function' ? children(id) : children
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label && <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>}
      {child}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-100'

export function Input({ label, hint, error, className, ...props }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id) => <input id={id} className={inputClass} {...props} />}</Field>
}

export function Textarea({ label, hint, error, className, rows = 3, ...props }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id) => <textarea id={id} rows={rows} className={inputClass} {...props} />}</Field>
}

export function Select({ label, hint, error, className, children, ...props }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id) => <select id={id} className={inputClass} {...props}>{children}</select>}</Field>
}

export function Badge({ className, children }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', className)}>{children}</span>
}

export function Card({ className, children, ...props }) {
  return <div className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)} {...props}>{children}</div>
}

export function Stat({ label, value, hint, tone = 'default', onClick, icon: Icon }) {
  const tones = { default: 'text-slate-900', warn: 'text-amber-600', danger: 'text-red-600', ok: 'text-green-700' }
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper type={onClick ? 'button' : undefined} onClick={onClick} className={cx('rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm', onClick && 'transition hover:border-amber-300 hover:shadow')}>
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      </div>
      <div className={cx('mt-1 text-2xl font-bold', tones[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Wrapper>
  )
}

export function Spinner({ label = 'Caricamento…' }) {
  return <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> {label}</div>
}

export function EmptyState({ icon: Icon = Info, title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Icon className="h-10 w-10 text-slate-300" />
      <p className="font-medium text-slate-700">{title}</p>
      {children && <p className="max-w-md text-sm text-slate-500">{children}</p>}
      {action}
    </div>
  )
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{error.message || String(error)}</div>
      {onRetry && <button type="button" onClick={onRetry} className="font-medium underline">Riprova</button>}
    </div>
  )
}

// Pannello laterale (dettagli) o finestra centrale. Esc chiude; il focus resta dentro il pannello.
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', side = false }) {
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      // Con due finestre aperte (es. rapportino sopra la scheda) Esc chiude solo quella in primo piano.
      const dialogs = document.querySelectorAll('[role="dialog"]')
      if (dialogs[dialogs.length - 1] === panel.current) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement
    panel.current?.querySelector('input, select, textarea, button:not([data-close])')?.focus()
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }
  return (
    <div className="fixed inset-0 z-50 flex bg-slate-900/40" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('flex w-full flex-col bg-white shadow-2xl', widths[size], side ? 'ml-auto h-full' : 'm-auto max-h-[92vh] rounded-xl')}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button type="button" data-close onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Chiudi"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cx('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', value === tab.value ? 'border-amber-400 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800')}
        >
          {tab.label}{tab.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Pagination({ page, pageSize, count, total, onChange }) {
  const hasNext = total !== undefined ? (page + 1) * pageSize < total : count === pageSize
  if (page === 0 && !hasNext) return null
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-600">
      <span>{total !== undefined ? `${page * pageSize + 1}–${page * pageSize + count} di ${total}` : `Pagina ${page + 1}`}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => onChange(page - 1)}>Precedente</Button>
        <Button size="sm" variant="secondary" disabled={!hasNext} onClick={() => onChange(page + 1)}>Successiva</Button>
      </div>
    </div>
  )
}

// ——— Notifiche e conferme ———
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [confirmState, setConfirmState] = useState(null)
  const remove = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((list) => [...list.slice(-3), { id, message, tone }])
    setTimeout(() => remove(id), tone === 'error' ? 7000 : 3500)
  }, [remove])
  const confirm = useCallback((options) => new Promise((resolve) => setConfirmState({ ...options, resolve })), [])
  const close = (result) => { confirmState?.resolve(result); setConfirmState(null) }
  const icons = { success: CheckCircle2, error: AlertTriangle, info: Info }
  const tones = { success: 'border-green-200 bg-green-50 text-green-900', error: 'border-red-200 bg-red-50 text-red-900', info: 'border-slate-200 bg-white text-slate-800' }

  return (
    <ToastContext.Provider value={{ toast: push, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = icons[toast.tone] || Info
          return (
            <div key={toast.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg', tones[toast.tone])}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{toast.message}</span>
              <button type="button" onClick={() => remove(toast.id)} aria-label="Chiudi notifica"><X className="h-4 w-4 opacity-60" /></button>
            </div>
          )
        })}
      </div>
      <Modal
        open={Boolean(confirmState)}
        onClose={() => close(false)}
        title={confirmState?.title || 'Confermi?'}
        size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => close(false)}>Annulla</Button>
          <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{confirmState?.confirmLabel || 'Conferma'}</Button>
        </>}
      >
        <p className="text-sm text-slate-700">{confirmState?.message}</p>
      </Modal>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

export const useDebounced = (value, delay = 250) => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export { cx }
