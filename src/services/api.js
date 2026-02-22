const RAG_API_URL = (import.meta.env.VITE_RAG_API_URL || '').trim().replace(/\/$/, '');
const RAG_ENDPOINT = RAG_API_URL || '/api/rag';

let refreshPromise = null;

const refreshAccessToken = async () => {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
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
  const { path, options = {}, apiToken = '' } = normalized;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (apiToken) {
    headers.Authorization = `Bearer ${apiToken}`;
  }

  const response = await fetch(path, { ...options, headers, credentials: 'include' });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && allowRefresh) {
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

export const getTokenStatus = async () => {
  const response = await fetch('/api/token/status', { credentials: 'include' });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || 'Impossibile verificare lo stato del token.');
  }
  return data;
};

export const getHealthStatus = async () => {
  const response = await fetch('/api/health', { credentials: 'include' });
  return response.ok;
};

export const saveToken = async (token) => {
  const response = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || 'Impossibile salvare il token.');
  }
  return data;
};

export const requestNewToken = async () => {
  const response = await fetch('/api/token', { credentials: 'include' });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || 'Impossibile richiedere un nuovo token.');
  }
  return data;
};

export const logout = async () => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
