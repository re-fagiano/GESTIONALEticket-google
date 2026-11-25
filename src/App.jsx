import { useCallback, useEffect, useState } from 'react'
import { Boxes, CalendarDays, FileText, LayoutDashboard, LogOut, Menu, PackageSearch, Phone, Settings, Users, Wrench, X, Zap } from 'lucide-react'
import { api, setUnauthorizedHandler } from './lib/api'
import { SharedDataProvider, navigate, useRoute } from './lib/hooks'
import { ROLES } from './lib/domain'
import { AuthContext } from './lib/auth'
import { Button, Input, Spinner, ToastProvider, cx } from './components/ui'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import Interventions from './pages/Interventions'
import CalendarPage from './pages/Calendar'
import Inventory from './pages/Inventory'
import SettingsPage from './pages/Settings'


const NAV = [
  { path: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: 'clienti', label: 'Clienti', icon: Users },
  { path: 'chiamate', label: 'Chiamate', icon: Phone },
  { path: 'riparazioni', label: 'Riparazioni', icon: Wrench },
  { path: 'ordini', label: 'Ordini ricambi', icon: PackageSearch },
  { path: 'preventivi', label: 'Preventivi nuovi', icon: FileText },
  { path: 'calendario', label: 'Calendario', icon: CalendarDays },
  { path: 'magazzino', label: 'Magazzino', icon: Boxes },
  { path: 'impostazioni', label: 'Impostazioni', icon: Settings },
]

const TYPE_BY_ROUTE = { chiamate: 'chiamata', riparazioni: 'riparazione', ordini: 'ordine_ricambi', preventivi: 'preventivo' }
// Vecchi indirizzi della v1 → nuove sezioni
const LEGACY_ROUTES = { customers: 'clienti', inventory: 'magazzino', calendar: 'calendario', settings: 'impostazioni', 'ordine-ricambi': 'ordini', 'preventivi-nuovi': 'preventivi' }

function Login({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      if (mode === 'login') {
        const { user } = await api.post('/api/auth/login', { email, password })
        onLogin(user)
      } else {
        await api.post('/api/auth/register', { email, password })
        setMessage({ tone: 'ok', text: "Registrazione inviata. Un amministratore deve approvare l'account prima del primo accesso." })
        setMode('login')
      }
    } catch (error) {
      setMessage({ tone: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2 text-xl font-bold text-slate-900"><Zap className="h-6 w-6 text-amber-400" /> FIXLAB</div>
        <p className="text-sm text-slate-500">{mode === 'login' ? 'Accedi al gestionale' : 'Richiedi un account'}</p>
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? undefined : 8} value={password} onChange={(e) => setPassword(e.target.value)} />
        {message && <p className={cx('rounded-lg p-2 text-sm', message.tone === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700')}>{message.text}</p>}
        <Button type="submit" className="w-full" loading={busy}>{mode === 'login' ? 'Accedi' : 'Registrati'}</Button>
        <button type="button" className="w-full text-center text-sm text-slate-500 hover:text-slate-800" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
        </button>
      </form>
    </div>
  )
}

function Shell({ user, onLogout }) {
  const route = useRoute()
  const [menuOpen, setMenuOpen] = useState(false)
  const path = LEGACY_ROUTES[route.path] || route.path

  let page
  if (TYPE_BY_ROUTE[path]) page = <Interventions key={path} type={TYPE_BY_ROUTE[path]} params={route.params} />
  else if (path === 'clienti') page = <Customers params={route.params} />
  else if (path === 'calendario') page = <CalendarPage params={route.params} />
  else if (path === 'magazzino') page = <Inventory params={route.params} />
  else if (path === 'impostazioni') page = <SettingsPage params={route.params} />
  else page = <Dashboard />

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900 text-slate-200 transition-transform md:static md:translate-x-0', menuOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-14 items-center justify-between px-4">
          <span className="flex items-center gap-2 text-lg font-bold text-white"><Zap className="h-5 w-5 text-amber-400" /> FIXLAB</span>
          <button type="button" className="md:hidden" onClick={() => setMenuOpen(false)} aria-label="Chiudi menu"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {NAV.map((item) => (
            <a key={item.path} href={`#/${item.path}`} onClick={() => setMenuOpen(false)} className={cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', path === item.path || (item.path === 'dashboard' && !NAV.some((n) => n.path === path)) ? 'bg-slate-800 font-medium text-amber-300' : 'hover:bg-slate-800/60')}>
              <item.icon className="h-4 w-4" /> {item.label}
            </a>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3 text-xs">
          <div className="truncate font-medium text-slate-100" title={user.email}>{user.email}</div>
          <div className="mb-2 text-slate-400">{ROLES[user.role] || user.role} · {user.operatorCode}</div>
          <Button variant="ghost" size="sm" icon={LogOut} className="w-full !justify-start !text-slate-300 hover:!bg-slate-800" onClick={onLogout}>Esci</Button>
        </div>
      </aside>
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 md:hidden">
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Apri menu"><Menu className="h-5 w-5" /></button>
          <span className="font-semibold">{NAV.find((item) => item.path === path)?.label || 'Dashboard'}</span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{page}</main>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(undefined)

  const checkSession = useCallback(async () => {
    try {
      const me = await api.get('/api/auth/me')
      if (me?.user) return setUser(me.user)
      // access token scaduto: se c'è ancora una sessione (cookie csrf presente) proviamo il refresh
      const hasSession = document.cookie.split(';').some((part) => part.trim().startsWith('csrf_token='))
      const refreshed = hasSession ? await api.post('/api/auth/refresh').catch(() => null) : null
      setUser(refreshed?.user || null)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verifica della sessione all'avvio
    checkSession()
  }, [checkSession])

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {})
    setUser(null)
    navigate('dashboard')
  }

  if (user === undefined) return <div className="min-h-screen bg-slate-50"><Spinner /></div>

  return (
    <ToastProvider>
      <AuthContext.Provider value={{ user, canEdit: user?.role === 'ADMIN' || user?.role === 'OPERATOR', isAdmin: user?.role === 'ADMIN' }}>
        {user ? (
          <SharedDataProvider>
            <Shell user={user} onLogout={logout} />
          </SharedDataProvider>
        ) : <Login onLogin={setUser} />}
      </AuthContext.Provider>
    </ToastProvider>
  )
}
