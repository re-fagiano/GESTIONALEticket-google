import crypto from 'node:crypto'

export const GOOGLE_SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.file',
  calendar: 'https://www.googleapis.com/auth/calendar',
}

const parsePrivateKey = (config) => {
  if (config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) return config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n')
  if (!config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64) return ''
  try {
    return Buffer.from(config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64, 'base64').toString('utf-8').replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}

export class GoogleApiError extends Error {
  constructor(status, message, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

// Client minimale per le API Google, senza librerie esterne. Due modalità:
//  1. OAuth con l'account Google del negozio (refresh token): funziona anche con Gmail personale,
//     sia per Drive (i file usano lo spazio dell'account) sia per Calendar. Ha la precedenza.
//  2. Service account (JWT RS256): ok per Calendar condiviso; per Drive serve un Drive condiviso.
// `fetchImpl` e `getStoredRefreshToken` sono iniettabili (test / token salvato nel database).
export const createGoogleClient = (config, { fetchImpl = globalThis.fetch, getStoredRefreshToken = async () => '' } = {}) => {
  const privateKey = parsePrivateKey(config)
  const hasServiceAccount = Boolean(config.GOOGLE_SERVICE_ACCOUNT_EMAIL && privateKey)
  const hasOAuthClient = Boolean(config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET)
  const tokenCache = new Map()

  const getRefreshToken = async () => {
    if (!hasOAuthClient) return ''
    return config.GOOGLE_OAUTH_REFRESH_TOKEN || (await getStoredRefreshToken()) || ''
  }

  const getMode = async () => {
    if (await getRefreshToken()) return 'oauth'
    if (hasServiceAccount) return 'service_account'
    return 'none'
  }

  const getAccessToken = async (scopes) => {
    const scope = [].concat(scopes).join(' ')
    const refreshToken = await getRefreshToken()
    const cacheKey = `${refreshToken ? 'oauth' : 'sa'}:${scope}`
    const cached = tokenCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

    if (refreshToken) {
      const response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: config.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.access_token) {
        throw new GoogleApiError(response.status, payload?.error_description || payload?.error || 'Token Google non disponibile', payload)
      }
      tokenCache.set(cacheKey, { token: payload.access_token, expiresAt: Date.now() + (Number(payload.expires_in || 3600) * 1000) })
      return payload.access_token
    }

    if (!hasServiceAccount) return ''

    const now = Math.floor(Date.now() / 1000)
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const claims = { iss: config.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }
    if (config.GOOGLE_IMPERSONATE_USER) claims.sub = config.GOOGLE_IMPERSONATE_USER
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).end().sign(privateKey).toString('base64url')

    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.access_token) {
      throw new GoogleApiError(response.status, payload?.error_description || payload?.error || 'Token Google non disponibile', payload)
    }
    tokenCache.set(cacheKey, { token: payload.access_token, expiresAt: Date.now() + (Number(payload.expires_in || 3600) * 1000) })
    return payload.access_token
  }

  const request = async ({ scopes, method = 'GET', url, body, headers = {}, raw = false }) => {
    const token = await getAccessToken(scopes)
    if (!token) throw new GoogleApiError(0, 'Integrazione Google non configurata')
    const isJson = body !== undefined && !(body instanceof Buffer) && typeof body !== 'string'
    const response = await fetchImpl(url.startsWith('http') ? url : `https://www.googleapis.com${url}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: isJson ? JSON.stringify(body) : body,
    })
    if (raw) return response
    const text = await response.text()
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
    if (!response.ok) throw new GoogleApiError(response.status, parsed?.error?.message || `Richiesta Google fallita (${response.status})`, parsed)
    return parsed
  }

  // Scambio del codice ricevuto dal consenso OAuth con il refresh token (flusso "Collega Google").
  const exchangeAuthCode = async ({ code, redirectUri }) => {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET,
      }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new GoogleApiError(response.status, payload?.error_description || payload?.error || 'Scambio codice Google fallito', payload)
    return payload
  }

  const buildConsentUrl = ({ redirectUri, state, scopes }) => {
    const params = new URLSearchParams({
      client_id: config.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: [].concat(scopes).join(' '),
      state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  const clearCache = () => tokenCache.clear()

  return {
    hasServiceAccount,
    hasOAuthClient,
    serviceAccountEmail: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    getMode,
    getAccessToken,
    request,
    exchangeAuthCode,
    buildConsentUrl,
    clearCache,
  }
}
