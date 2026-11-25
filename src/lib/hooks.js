import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, fetchAll } from './api'

// Carica dati asincroni con stato di caricamento/errore e possibilità di ricaricare.
export const useAsync = (loader, deps = [], { keepPrevious = true } = {}) => {
  const [state, setState] = useState({ data: undefined, loading: true, error: null })
  const counter = useRef(0)
  const load = useCallback(async () => {
    const run = ++counter.current
    setState((prev) => ({ data: keepPrevious ? prev.data : undefined, loading: true, error: null }))
    try {
      const data = await loader()
      if (run === counter.current) setState({ data, loading: false, error: null })
      return data
    } catch (error) {
      if (run === counter.current) setState((prev) => ({ data: prev.data, loading: false, error }))
      return undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { load() }, [load])
  return { ...state, reload: load, setData: (updater) => setState((prev) => ({ ...prev, data: typeof updater === 'function' ? updater(prev.data) : updater })) }
}

// ——— Routing con hash (#/magazzino?stock=low): nessuna dipendenza, funziona con il fallback SPA del server ———
const parseHash = () => {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  return { path: path || 'dashboard', params: Object.fromEntries(new URLSearchParams(query)) }
}

export const useRoute = () => {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const navigate = (path, params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== null)).toString()
  window.location.hash = `/${path}${query ? `?${query}` : ''}`
}

// ——— Dati condivisi: clienti e operatori servono in quasi tutte le schermate ———
const SharedDataContext = createContext(null)

export function SharedDataProvider({ children }) {
  const [customers, setCustomers] = useState([])
  const [operators, setOperators] = useState([])
  const [loaded, setLoaded] = useState(false)

  const reloadCustomers = useCallback(async () => {
    const rows = await fetchAll('/api/customers', { sort: 'name', order: 'asc' })
    setCustomers(rows)
    return rows
  }, [])

  const reloadOperators = useCallback(async () => {
    const rows = await api.get('/api/users/operators').catch(() => [])
    setOperators(Array.isArray(rows) ? rows : [])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- caricamento iniziale dei dati condivisi
    Promise.allSettled([reloadCustomers(), reloadOperators()]).finally(() => setLoaded(true))
  }, [reloadCustomers, reloadOperators])

  const value = useMemo(() => {
    const byId = new Map(customers.map((customer) => [customer.id, customer]))
    const operatorById = new Map(operators.map((operator) => [operator.id, operator]))
    return {
      customers,
      operators,
      loaded,
      customerById: (id) => byId.get(id),
      operatorName: (id) => operatorById.get(id)?.email?.split('@')[0] || '',
      reloadCustomers,
      upsertCustomer: (customer) => setCustomers((list) => {
        const exists = list.some((entry) => entry.id === customer.id)
        const next = exists ? list.map((entry) => (entry.id === customer.id ? customer : entry)) : [...list, customer]
        return next.sort((a, b) => a.name.localeCompare(b.name, 'it'))
      }),
    }
  }, [customers, operators, loaded, reloadCustomers])

  return createElement(SharedDataContext.Provider, { value }, children)
}

export const useShared = () => useContext(SharedDataContext)
