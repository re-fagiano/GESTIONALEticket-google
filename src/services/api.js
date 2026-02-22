const getCsrfToken = () => {
  if (typeof document === 'undefined') return '';
  const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('csrf_token='));
  return cookie ? decodeURIComponent(cookie.slice('csrf_token='.length)) : '';
};

const RAG_API_URL = (import.meta.env.VITE_RAG_API_URL || '').trim().replace(/\/$/, '');
const RAG_ENDPOINT = RAG_API_URL || '/api/rag';

let refreshPromise = null;

const refreshAccessToken = async () => {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': getCsrfToken() } })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const err = new Error(payload?.error || 'Sessione scaduta.');
          err.status = response.status;
          throw err;
        }
        return payload?.accessToken || '';
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

export const callRagApi = async (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload RAG non valido.');
  }

  try {
    const response = await fetch(RAG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    if (!response.ok) {
      const message = parsed?.error || `Errore RAG: ${response.status}`;
      if (typeof message === 'string' && message.toLowerCase().includes('rag_api_url')) {
        throw new Error('RAG non configurata. Imposta VITE_RAG_API_URL (client) o RAG_API_URL (server).');
      }
      throw new Error(message);
    }

    return parsed;
  } catch (error) {
    const message = error?.message || 'Errore durante la chiamata RAG.';
    if (message.toLowerCase().includes('rag non configurata')) {
      throw error;
    }
    throw new Error(message);
  }
};

export const apiFetch = async (input, maybeOptions = {}, maybeToken = '', allowRefresh = true) => {
  const normalized = typeof input === 'string'
    ? { path: input, options: maybeOptions, apiToken: maybeToken }
    : (input || {});
  const { path, options = {}, apiToken = '', allowRefresh: allowRefreshOpt } = normalized;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }

  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(path, { ...options, method, headers, credentials: 'include' });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const canRefresh = allowRefreshOpt === undefined ? allowRefresh : allowRefreshOpt;
    if (response.status === 401 && canRefresh) {
      const refreshedToken = await refreshAccessToken().catch(() => '');
      if (refreshedToken) {
        return apiFetch({ path, options, apiToken: refreshedToken }, {}, '', false);
      }
    }
    const error = new Error(payload?.error || `Errore API: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};

export const apiFetchWithRetry = async (input, maybeOptions = {}, maybeConfig = {}) => {
  const normalized = typeof input === 'string'
    ? {
        path: input,
        options: maybeOptions,
        apiToken: maybeConfig.apiToken || '',
        onRetryStatus: maybeConfig.onRetryStatus || (() => {})
      }
    : (input || {});
  const { path, options = {}, apiToken = '', onRetryStatus = () => {} } = normalized;
  const method = (options.method || 'GET').toUpperCase();
  const retryable = ['GET', 'PUT'].includes(method);
  const maxAttempts = 3;
  let attempt = 0;
  let lastError;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      if (attempt > 1) {
        onRetryStatus({ attempt, maxAttempts, path });
      }
      const result = await apiFetch({ path, options, apiToken });
      onRetryStatus(null);
      return result;
    } catch (error) {
      lastError = error;
      const status = error?.status;
      if (!retryable || ![502, 503].includes(status) || attempt >= maxAttempts) {
        onRetryStatus(null);
        throw error;
      }
      const delay = 500 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  onRetryStatus(null);
  throw lastError;
};


const toEntityState = (rows = []) => {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row?.id || ''),
      updatedAt: typeof row?.updatedAt === 'string' ? row.updatedAt : '',
      version: Number.isFinite(Number(row?.version)) ? Number(row.version) : 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const version = normalized.reduce((sum, item) => sum + item.version, 0);
  const source = JSON.stringify(normalized);
  let checksum = '';
  for (let i = 0; i < source.length; i += 1) {
    checksum = ((checksum << 5) - checksum + source.charCodeAt(i)) | 0;
  }

  return { version, checksum: String(checksum) };
};

export const syncData = async ({
  protocolVersion = 1,
  clientId = 'web-client',
  lastSyncAt = null,
  changes = {},
  localData = {},
  apiToken = ''
} = {}) => {
  const state = {
    customers: toEntityState(localData.customers),
    tickets: toEntityState(localData.tickets),
    inventory: toEntityState(localData.inventory),
    interventions: toEntityState(localData.interventions),
  };

  return apiFetchWithRetry({
    path: '/api/sync',
    options: {
      method: 'POST',
      body: JSON.stringify({
        protocolVersion,
        clientId,
        lastSyncAt,
        state,
        changes,
      })
    },
    apiToken,
  });
};

export const callDeepSeekApi = async ({ endpoint, requestHeaders, safeSubject, safeDescription }) => {
  const systemPrompt = 'Sei un tecnico esperto di elettrodomestici. Analizza il problema e fornisci: 1) Possibile Causa 2) Diagnosi 3) Ricambi.';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Oggetto: ${safeSubject}. Descrizione: ${safeDescription}` }
      ],
      stream: false
    })
  });

  if (!response.ok) throw new Error(`Errore API: ${response.status}`);

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Risposta AI non valida.');
  return content;
};

export const login = async ({ username, password }) => {
  return apiFetch({
    path: '/api/auth/login',
    options: {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    },
    allowRefresh: false,
  });
};

export const getMe = async () => apiFetch({ path: '/api/auth/me', options: {}, apiToken: '', allowRefresh: true });

export const getHealthStatus = async () => {
  const response = await fetch('/api/health', { credentials: 'include' });
  return response.ok;
};

export const logout = async () => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
