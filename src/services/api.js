const getCsrfToken = () => {
  if (typeof document === 'undefined') return '';
  const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('csrf_token='));
  return cookie ? decodeURIComponent(cookie.slice('csrf_token='.length)) : '';
};

const RAG_API_URL = (import.meta.env.VITE_RAG_API_URL || '').trim().replace(/\/$/, '');
const RAG_ENDPOINT = RAG_API_URL || '/api/rag';
const AUTH_TOKEN_KEY = 'gestionale_jwt';

let unauthorizedHandler = null;

const assertFunction = (fn) => {
  if (typeof fn !== 'function') {
    throw new Error('INVALID_PERSISTED_STATE_FN');
  }
};

const getStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage || window.sessionStorage || null;
};

let authToken = (() => {
  const storage = getStorage();
  return storage?.getItem(AUTH_TOKEN_KEY) || '';
})();

export const setUnauthorizedHandler = (handler) => {
  if (handler == null) {
    unauthorizedHandler = null;
    return;
  }
  assertFunction(handler);
  unauthorizedHandler = handler;
};

export const setAuthToken = (token, persist = true) => {
  authToken = String(token || '');
  const storage = getStorage();
  if (!storage) return;
  if (!authToken) {
    storage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  if (persist) storage.setItem(AUTH_TOKEN_KEY, authToken);
};

export const clearAuthToken = () => {
  setAuthToken('');
};

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
        const nextToken = payload?.accessToken || '';
        if (nextToken) setAuthToken(nextToken);
        return nextToken;
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
  const token = apiToken || authToken;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
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
    if (response.status === 401) {
      clearAuthToken();
      if (typeof unauthorizedHandler === 'function') {
        unauthorizedHandler();
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
  assertFunction(onRetryStatus);
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

export const syncData = async () => {
  const [customers, tickets, inventory] = await Promise.all([
    apiFetch({ path: '/api/customers', options: { method: 'GET' }, allowRefresh: false }),
    apiFetch({ path: '/api/tickets', options: { method: 'GET' }, allowRefresh: false }),
    apiFetch({ path: '/api/inventory', options: { method: 'GET' }, allowRefresh: false }),
  ]);

  return {
    serverTime: new Date().toISOString(),
    pulled: {
      customers: Array.isArray(customers) ? customers : [],
      tickets: Array.isArray(tickets) ? tickets : [],
      inventory: Array.isArray(inventory) ? inventory : [],
      interventions: [],
    },
  };
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

export const login = async ({ email, password }) => {
  const response = await apiFetch({
    path: '/api/auth/login',
    options: {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
    allowRefresh: false,
  });
  if (response?.accessToken) setAuthToken(response.accessToken);
  return response;
};

export const register = async ({ email, password }) => {
  const response = await apiFetch({
    path: '/api/auth/register',
    options: {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
    allowRefresh: false,
  });
  if (response?.accessToken) setAuthToken(response.accessToken);
  return response;
};

export const getMe = async () => apiFetch({ path: '/api/auth/me', options: {}, apiToken: '', allowRefresh: true });

export const getHealthStatus = async () => {
  const response = await fetch('/api/health', { credentials: 'include' });
  return response.ok;
};

export const logout = async () => {
  try {
    return await apiFetch({ path: '/api/auth/logout', options: { method: 'POST' }, allowRefresh: false });
  } finally {
    clearAuthToken();
  }
};


export const triggerAdminBackup = async () => apiFetch({
  path: '/api/admin/backup',
  options: { method: 'POST' },
});

export const getLatestAdminBackup = async () => apiFetch({
  path: '/api/admin/backup/latest',
  options: { method: 'GET' },
});

export const downloadAdminExportJson = async () => {
  const response = await fetch('/api/admin/export/json', { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Export JSON non disponibile.');
  }
  return response.blob();
};

export const downloadAdminExportCsv = async () => {
  const response = await fetch('/api/admin/export/csv', { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Export CSV non disponibile.');
  }
  return response.blob();
};

export const createCustomer = async (customer) => apiFetch({
  path: '/api/customers',
  options: { method: 'POST', body: JSON.stringify(customer) },
});

export const updateCustomer = async (id, customer) => apiFetch({
  path: `/api/customers/${id}`,
  options: { method: 'PUT', body: JSON.stringify(customer) },
});

export const createTicket = async (ticket) => apiFetch({
  path: '/api/tickets',
  options: { method: 'POST', body: JSON.stringify(ticket) },
});

export const updateTicket = async (id, ticket) => apiFetchWithRetry({
  path: `/api/tickets/${id}`,
  options: { method: 'PUT', body: JSON.stringify(ticket) },
});

export const createIntervention = async (intervention) => apiFetchWithRetry({
  path: '/api/interventions',
  options: { method: 'POST', body: JSON.stringify(intervention) },
});

export const updateIntervention = async (id, intervention) => apiFetchWithRetry({
  path: `/api/interventions/${id}`,
  options: { method: 'PUT', body: JSON.stringify(intervention) },
});

export const deleteIntervention = async (id) => apiFetch({
  path: `/api/interventions/${id}`,
  options: { method: 'DELETE' },
});


export const patchInterventoStatus = async (id, status) => apiFetch({
  path: `/api/interventions/${id}`,
  options: { method: 'PATCH', body: JSON.stringify({ status }) },
});

export const convertChiamataToRiparazione = async (id) => apiFetch({
  path: `/api/riparazioni/from-chiamata/${id}`,
  options: { method: 'POST' },
});

export const createInventoryItem = async (item) => apiFetch({
  path: '/api/inventory',
  options: { method: 'POST', body: JSON.stringify(item) },
});

export const updateInventoryItem = async (id, item) => apiFetchWithRetry({
  path: `/api/inventory/${id}`,
  options: { method: 'PUT', body: JSON.stringify(item) },
});

export const replaceInventoryItem = async (id, item) => apiFetch({
  path: `/api/inventory/${id}`,
  options: { method: 'PUT', body: JSON.stringify(item) },
});

export const deleteEntity = async (type, id) => apiFetch({
  path: `/api/${type}/${id}`,
  options: { method: 'DELETE' },
});

export const importData = async (payload) => apiFetch({
  path: '/api/import',
  options: { method: 'POST', body: JSON.stringify(payload) },
});
