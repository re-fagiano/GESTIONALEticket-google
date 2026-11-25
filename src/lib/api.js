// Client HTTP unico per l'app: cookie di sessione, token CSRF, rinnovo automatico della sessione
// ed errori uniformi (ApiError con status, code e dati del server).

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message)
    this.status = status
    this.code = data?.code || ''
    this.data = data
  }
}

const csrfToken = () => {
  const entry = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('csrf_token='))
  return entry ? decodeURIComponent(entry.slice('csrf_token='.length)) : ''
}

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (handler) => { onUnauthorized = handler || (() => {}) }

let refreshing = null
const refreshSession = () => {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken() } })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { refreshing = null })
  }
  return refreshing
}

export const request = async (method, path, body, { retry = true, raw = false, signal } = {}) => {
  const headers = {}
  const isForm = body instanceof FormData
  const isBlob = typeof Blob !== 'undefined' && body instanceof Blob
  if (body !== undefined && !isForm) headers['Content-Type'] = isBlob ? (body.type || 'application/octet-stream') : 'application/json'
  if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrfToken()

  let response
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : (isForm || isBlob ? body : JSON.stringify(body)),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError(0, 'Server non raggiungibile. Controlla la connessione.')
  }

  if (response.status === 401 && retry && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) return request(method, path, body, { retry: false, raw, signal })
    onUnauthorized()
  }
  if (raw && response.ok) return response

  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, data?.error || `Errore ${response.status}`, data)
  return data
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body = {}, opts) => request('POST', path, body, opts),
  put: (path, body = {}, opts) => request('PUT', path, body, opts),
  patch: (path, body = {}, opts) => request('PATCH', path, body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
}

export const qs = (params = {}) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}

// Scarica tutte le pagine di un elenco (il server restituisce al massimo 500 righe per richiesta).
export const fetchAll = async (path, params = {}, pageSize = 500) => {
  const rows = []
  for (let skip = 0; ; skip += pageSize) {
    const page = await api.get(`${path}${qs({ ...params, skip, take: pageSize })}`)
    rows.push(...(Array.isArray(page) ? page : []))
    if (!Array.isArray(page) || page.length < pageSize) return rows
  }
}

// Scarica un file prodotto dal server (export CSV/JSON) mantenendo i cookie di sessione.
export const download = async (path, fallbackName) => {
  const response = await request('GET', path, undefined, { raw: true })
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') || ''
  const name = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
