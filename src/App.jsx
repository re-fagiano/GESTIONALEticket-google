import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Users,
  Ticket,
  Wrench,
  Plus,
  Bot,
  Menu,
  X,
  Trash2,
  RefreshCw,
  Zap,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Package, // Icona Magazzino
  AlertTriangle, // Icona Avvisi
  Phone,
  MapPin,
  Download,
  Upload,
  FileSpreadsheet
} from 'lucide-react';
import { INVENTORY_HEADERS, parseInventoryFile } from './utils/inventoryImport';

const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const allowLocalOverrides = isLocalhost;
const forcedProxyEndpoint = '/api/deepseek';

const DEEPSEEK_API_URL = (import.meta.env.VITE_DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_API_KEY = (import.meta.env.VITE_DEEPSEEK_API_KEY || '').trim();
const HAS_ENV_DEEPSEEK_KEY = Boolean(DEEPSEEK_API_KEY && DEEPSEEK_API_KEY.trim());
const ENV_DEEPSEEK_API_URL = DEEPSEEK_API_URL;
const RAG_API_URL = (import.meta.env.VITE_RAG_API_URL || '').trim().replace(/\/$/, '');
const RAG_ENDPOINT = RAG_API_URL || '/api/rag';

const storageAvailable = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
const storageFallbackState = { active: false };
const IDB_DB_NAME = 'gestionale_storage';
const IDB_STORE = 'keyval';

const openIdb = () => {
  if (!isBrowser) return Promise.reject(new Error('IDB non disponibile'));
  if (!openIdb.promise) {
    openIdb.promise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(IDB_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return openIdb.promise;
};

const idbGet = async (key) => {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
};

const idbSet = async (key, value) => {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const request = store.put(value, key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
};

const nowIso = () => new Date().toISOString();

const safeGetItem = (key, fallback = null) => {
  if (!storageAvailable) return fallback;
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : saved;
  } catch (e) {
    storageFallbackState.active = true;
    console.warn('Storage non accessibile, uso fallback', e);
    return fallback;
  }
};

const safeSetItem = (key, value) => {
  if (!storageAvailable) {
    storageFallbackState.active = true;
    idbSet(key, value).catch((error) => console.warn('Fallback IndexedDB fallito', error));
    return false;
  }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    storageFallbackState.active = true;
    idbSet(key, value).catch((error) => console.warn('Fallback IndexedDB fallito', error));
    console.warn('Impossibile scrivere su storage, i dati non saranno salvati', e);
    return false;
  }
};

const callRagApi = async (payload = {}) => {
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

const loadData = (key, defaultData) => {
  const saved = safeGetItem(key, null);
  if (!saved) return defaultData;
  try {
    return JSON.parse(saved);
  } catch (e) {
    console.error("Errore lettura memoria", e);
    return defaultData;
  }
};

const cacheKeys = {
  customers: 'cache_customers',
  tickets: 'cache_tickets',
  inventory: 'cache_inventory',
  settings: 'cache_settings'
};

const loadCache = (key, fallback) => loadData(cacheKeys[key], fallback);

const saveCache = (key, value) => safeSetItem(cacheKeys[key], JSON.stringify(value));

const sanitizeTicket = (ticket, idx = 0) => {
  if (!ticket || typeof ticket !== 'object') return null;

  const safeDate =
    typeof ticket.date === 'string' && !Number.isNaN(new Date(ticket.date).getTime())
      ? ticket.date
      : '';

  const safeTime = typeof ticket.time === 'string' && ticket.time.trim() ? ticket.time.trim() : '09:00';
  const safeSubject =
    typeof ticket.subject === 'string' && ticket.subject.trim()
      ? ticket.subject.trim()
      : `Ticket #${(ticket.id || idx) ?? idx}`;

  return {
    id: ticket.id || `${Date.now()}-${idx}`,
    subject: safeSubject,
    description: typeof ticket.description === 'string' ? ticket.description : '',
    customerId: typeof ticket.customerId === 'string' ? ticket.customerId : '',
    status: ticket.status || 'aperto',
    date: safeDate,
    time: safeTime,
    updatedAt: typeof ticket.updatedAt === 'string' ? ticket.updatedAt : nowIso(),
    version: Number.isFinite(Number(ticket.version)) ? Number(ticket.version) : 1
  };
};

const sanitizeTickets = (list, fallback = []) => {
  const source = Array.isArray(list) ? list : fallback;
  return source.map((t, idx) => sanitizeTicket(t, idx)).filter(Boolean);
};

const sanitizeCustomer = (customer, idx = 0) => {
  if (!customer || typeof customer !== 'object') return null;

  const safeName = typeof customer.name === 'string' && customer.name.trim() ? customer.name.trim() : `Cliente #${idx + 1}`;
  const safeEmail = typeof customer.email === 'string' ? customer.email.trim() : '';
  const safePhone = typeof customer.phone === 'string' ? customer.phone.trim() : '';
  const safeAddress = typeof customer.address === 'string' ? customer.address.trim() : '';

  return {
    id: customer.id || `${Date.now()}-${idx}`,
    name: safeName,
    email: safeEmail,
    phone: safePhone,
    address: safeAddress,
    updatedAt: typeof customer.updatedAt === 'string' ? customer.updatedAt : nowIso(),
    version: Number.isFinite(Number(customer.version)) ? Number(customer.version) : 1
  };
};

const sanitizeCustomers = (list, fallback = []) => {
  const source = Array.isArray(list) ? list : fallback;
  return source.map((c, idx) => sanitizeCustomer(c, idx)).filter(Boolean);
};

const sanitizeInventoryItem = (item, idx = 0) => {
  if (!item || typeof item !== 'object') return null;

  const parsedQty = Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0;
  const parsedPrice = Number.isFinite(Number(item.price)) ? Number(item.price) : 0;
  const parsedMinQty = Number.isFinite(Number(item.minQty)) ? Number(item.minQty) : 0;
  const safeCode =
    typeof item.code === 'string' && item.code.trim()
      ? item.code.trim()
      : (typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `RIC-${idx + 1}`);
  const safeDescription =
    typeof item.description === 'string' && item.description.trim()
      ? item.description.trim()
      : (typeof item.name === 'string' ? item.name.trim() : '');

  return {
    id: item.id || `${Date.now()}-${idx}`,
    code: safeCode,
    name: typeof item.name === 'string' ? item.name.trim() : `Ricambio #${idx + 1}`,
    description: safeDescription,
    location: typeof item.location === 'string' ? item.location.trim() : '',
    qty: parsedQty,
    price: parsedPrice,
    minQty: parsedMinQty,
    pendingSync: Boolean(item.pendingSync),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso(),
    version: Number.isFinite(Number(item.version)) ? Number(item.version) : 1
  };
};

const sanitizeInventoryList = (list, fallback = []) => {
  const source = Array.isArray(list) ? list : fallback;
  return source.map((item, idx) => sanitizeInventoryItem(item, idx)).filter(Boolean);
};

const parseCsvRows = (text = '') => {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const delimiter = lines[0]?.includes(';') && !lines[0]?.includes(',') ? ';' : ',';
  const headers = lines.shift()?.split(delimiter).map((h) => h.trim()) || [];
  return lines.map((line) => {
    const cols = line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
    return headers.reduce((acc, header, idx) => {
      acc[header] = cols[idx] ?? '';
      return acc;
    }, {});
  });
};

const initialCustomers = [
  { id: '1', name: 'Maria Bianchi', email: 'maria@test.com', phone: '3339988776', address: 'Via dei Fiori 12' },
  { id: '2', name: 'Ristorante Da Luigi', email: 'info@luigi.com', phone: '06123456', address: 'Piazza Navona 5' }
];

const initialTickets = [
  { id: '101', subject: 'Lavatrice non scarica', description: 'La lavatrice Bosch si blocca piena di acqua', customerId: '1', status: 'aperto', date: new Date().toISOString().split('T')[0], time: '09:00' },
  { id: '102', subject: 'Frigorifero caldo', description: 'Il reparto freezer funziona ma il frigo è caldo', customerId: '2', status: 'in lavorazione', date: new Date().toISOString().split('T')[0], time: '14:30' }
];

const initialInventory = [
  { id: 'p1', code: 'POM-001', name: 'Pompa Scarico Universale', description: 'Pompa Scarico Universale', location: 'AF-01-A', qty: 3, price: 25.00, minQty: 5 },
  { id: 'p2', code: 'CUS-002', name: 'Cuscinetti Cestello', description: 'Cuscinetti Cestello', location: 'BF-02-C', qty: 10, price: 15.50, minQty: 2 },
  { id: 'p3', code: 'SCH-003', name: 'Scheda Elettronica Samsung', description: 'Scheda Elettronica Samsung', location: 'SEC-09', qty: 1, price: 120.00, minQty: 1 }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // ✅ FIX 1: conflictState DEVE stare dentro il componente
  const [conflictState, setConflictState] = useState(null);

  // ✅ FIX 2: mancavano questi state (usati nei button disabled e nei try/finally)
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [isSavingTicket, setIsSavingTicket] = useState(false);
  const [isSavingPart, setIsSavingPart] = useState(false);

  // --- STATO CALENDARIO ---
  const [currentDate, setCurrentDate] = useState(new Date());

  // --- STATO APP ---
  const [customers, setCustomers] = useState(() => sanitizeCustomers(loadCache('customers', initialCustomers), initialCustomers));
  const [tickets, setTickets] = useState(() => sanitizeTickets(loadCache('tickets', initialTickets), initialTickets));
  const [inventory, setInventory] = useState(() => sanitizeInventoryList(loadCache('inventory', initialInventory), initialInventory));
  const [settings, setSettings] = useState(() => loadCache('settings', []));
  const [storageWarning, setStorageWarning] = useState(null);
  const [apiToken, setApiToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [maskedToken, setMaskedToken] = useState('');
  const [showTokenPrompt, setShowTokenPrompt] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [exportNotice, setExportNotice] = useState(null);
  // Stato di connettività del backend (assume offline di default)
  const [backendOnline, setBackendOnline] = useState(false);

  // Stato per i messaggi di retry quando le chiamate API falliscono
  const [retryStatus, setRetryStatus] = useState('');

  // Stato per l’ultimo backup automatico e relativo timestamp
  const [latestBackup, setLatestBackup] = useState(null);
  const [autoBackupAt, setAutoBackupAt] = useState(null);

  // Stato per la notifica dei backup manuali/automatici
  const [backupStatus, setBackupStatus] = useState('');

  // Stato che indica se la storage persistente è in fase di richiesta
  const [isPersistingStorage, setIsPersistingStorage] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Stato per le notifiche toast
  const [toasts, setToasts] = useState([]);

  // Funzione per aggiungere notifiche toast
  const addToast = (message, tone = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  // --- CACHE LOCALE ---
  useEffect(() => {
    if (!saveCache('customers', customers)) {
      setStorageWarning('Impossibile salvare i clienti nel browser: storage disabilitato.');
    }
  }, [customers]);

  useEffect(() => {
    if (!saveCache('tickets', sanitizeTickets(tickets))) {
      setStorageWarning('Impossibile salvare i ticket nel browser: storage disabilitato.');
    }
  }, [tickets]);

  useEffect(() => {
    if (!saveCache('inventory', inventory)) {
      setStorageWarning('Impossibile salvare il magazzino nel browser: storage disabilitato.');
    }
  }, [inventory]);

  useEffect(() => {
    if (!saveCache('settings', settings)) {
      setStorageWarning('Impossibile salvare le impostazioni nel browser: storage disabilitato.');
    }
  }, [settings]);

  useEffect(() => {
    if (!storageAvailable || storageFallbackState.active) {
      const loadFallback = async () => {
        try {
          const [customersRaw, ticketsRaw, inventoryRaw, settingsRaw, backupRaw, backupAt] = await Promise.all([
            idbGet(cacheKeys.customers),
            idbGet(cacheKeys.tickets),
            idbGet(cacheKeys.inventory),
            idbGet(cacheKeys.settings),
            idbGet('lastBackup'),
            idbGet('lastBackupAt'),
          ]);
          if (customersRaw) setCustomers(sanitizeCustomers(JSON.parse(customersRaw), initialCustomers));
          if (ticketsRaw) setTickets(sanitizeTickets(JSON.parse(ticketsRaw), initialTickets));
          if (inventoryRaw) setInventory(sanitizeInventoryList(JSON.parse(inventoryRaw), initialInventory));
          if (settingsRaw) setSettings(JSON.parse(settingsRaw));
          if (backupRaw) setLatestBackup(JSON.parse(backupRaw));
          if (backupAt) setAutoBackupAt(backupAt);
        } catch (error) {
          console.warn('Fallback IndexedDB non disponibile', error);
        }
      };
      loadFallback();
    }
  }, []);

  useEffect(() => {
    const loadTokenStatus = async () => {
      try {
        const response = await fetch('/api/token/status', { credentials: 'include' });
        if (response.status === 204) {
          setShowTokenPrompt(true);
          return;
        }
        const data = await response.json().catch(() => null);
        if (data?.maskedToken) {
          setMaskedToken(data.maskedToken);
          setShowTokenPrompt(false);
        }
      } catch {
        setShowTokenPrompt(true);
      }
    };
    loadTokenStatus();
  }, []);

  useEffect(() => {
    if (!exportNotice) return;
    const timer = setTimeout(() => setExportNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [exportNotice]);

  // Modal & AI State
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewPart, setShowNewPart] = useState(false);

  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [currentTicketForAi, setCurrentTicketForAi] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [runtimeApiKey, setRuntimeApiKey] = useState(() => {
    if (!allowLocalOverrides) return '';
    const stored = safeGetItem('deepseekApiKey', '');
    return stored ? stored.trim() : '';
  });
  const [runtimeApiUrl, setRuntimeApiUrl] = useState(() => {
    if (!allowLocalOverrides) return forcedProxyEndpoint;
    const stored = safeGetItem('deepseekApiUrl', '');
    return (stored || ENV_DEEPSEEK_API_URL || '').trim();
  });

  const apiKeyToUse = allowLocalOverrides ? (runtimeApiKey || DEEPSEEK_API_KEY).trim() : '';
  const apiUrlToUse = allowLocalOverrides ? (runtimeApiUrl || DEEPSEEK_API_URL).trim() : forcedProxyEndpoint;
  const hasClientKey = Boolean(apiKeyToUse);
  const shouldUseProxy = !allowLocalOverrides || apiUrlToUse.startsWith('/');
  const endpoint = shouldUseProxy ? forcedProxyEndpoint : `${apiUrlToUse}/chat/completions`;
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...(!shouldUseProxy && hasClientKey ? { Authorization: `Bearer ${apiKeyToUse}` } : {})
  };
  const keyModeLabel = !allowLocalOverrides
    ? 'Proxy backend (chiavi gestite lato server)'
    : runtimeApiKey
      ? 'Usando chiave locale'
      : HAS_ENV_DEEPSEEK_KEY
        ? 'Usando chiave da build'
        : 'Nessuna chiave';
  const aiEnabled = shouldUseProxy || hasClientKey;

  const apiFetch = async (path, options = {}) => {
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
      const error = new Error(payload?.error || `Errore API: ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };

  const apiFetchWithRetry = async (path, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const retryable = ['GET', 'PUT'].includes(method);
    const maxAttempts = 3;
    let attempt = 0;
    let lastError;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        if (attempt > 1) {
          setRetryStatus({ attempt, maxAttempts, path });
        }
        const result = await apiFetch(path, options);
        setRetryStatus(null);
        return result;
      } catch (error) {
        lastError = error;
        const status = error?.status;
        if (!retryable || ![502, 503].includes(status) || attempt >= maxAttempts) {
          setRetryStatus(null);
          throw error;
        }
        const delay = 500 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    setRetryStatus(null);
    throw lastError;
  };

  const refreshFromBackend = async () => {
    if (!apiToken && !maskedToken && !isLocalhost) {
      setStorageWarning('Configura un token API per sincronizzare i dati.');
      return;
    }
    try {
      setSyncStatus('Caricamento dati dal backend...');
      setIsSyncing(true);
      const data = await apiFetchWithRetry('/api/bootstrap');
      setCustomers(sanitizeCustomers(data.customers, initialCustomers));
      setTickets(sanitizeTickets(data.tickets, initialTickets));
      setInventory(sanitizeInventoryList(data.inventory, initialInventory));
      setSettings(Array.isArray(data.settings) ? data.settings : []);
      setStorageWarning(null);
      setSyncStatus('Dati sincronizzati con il backend.');
      setBackendOnline(true);
    } catch (error) {
      console.error('Errore sincronizzazione backend', error);
      setStorageWarning(error.message || 'Impossibile contattare il backend.');
      setSyncStatus('Backend non raggiungibile: uso cache locale.');
      setBackendOnline(false);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    refreshFromBackend();
  }, [apiToken]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/health', { credentials: 'include' });
        setBackendOnline(response.ok);
      } catch {
        setBackendOnline(false);
      }
    }, 180000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshFromBackend();
    }, 3600000);
    return () => clearInterval(interval);
  }, [apiToken]);

  useEffect(() => {
    if (!allowLocalOverrides) return;
    if (!safeSetItem('deepseekApiKey', runtimeApiKey)) {
      setStorageWarning('Impossibile salvare la chiave DeepSeek nel browser: storage disabilitato.');
    }
  }, [runtimeApiKey]);

  useEffect(() => {
    if (!allowLocalOverrides) return;
    if (runtimeApiUrl && !safeSetItem('deepseekApiUrl', runtimeApiUrl)) {
      setStorageWarning('Impossibile salvare l\'endpoint DeepSeek nel browser: storage disabilitato.');
    }
  }, [runtimeApiUrl]);

  // Forms
  const [newCustomer, setNewCustomer] = useState({ name: '', email: '', phone: '', address: '' });
  const [newTicket, setNewTicket] = useState({
    subject: '', description: '', customerId: '', status: 'aperto',
    date: new Date().toISOString().split('T')[0], time: '09:00'
  });
  const [newPart, setNewPart] = useState({ code: '', name: '', description: '', location: '', qty: 1, price: 0, minQty: 5 });
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);
  const inventoryFileInputRef = useRef(null);
  const [inventoryImportPreview, setInventoryImportPreview] = useState([]);
  const [inventoryImportHeaderError, setInventoryImportHeaderError] = useState('');
  const [showInventoryImportModal, setShowInventoryImportModal] = useState(false);
  const [isImportingInventory, setIsImportingInventory] = useState(false);

  // --- AZIONI ---
  const handleApiError = (error, fallback) => {
    if (error?.status === 401) {
      setStorageWarning('Token API mancante o non valido. Verifica il token nelle impostazioni.');
      addToast('Token non valido o mancante.', 'error');
      return;
    }
    const message = error?.message || fallback;
    const causes = ['Backend offline', 'Token errato', 'Problemi di rete'];
    setStorageWarning(`${message} Possibili cause: ${causes.join(', ')}.`);
    addToast(message, 'error');
  };

  // ✅ FIX 3: definizione mancante (SettingsPanel la usa)
  const handleSaveToken = async () => {
    const token = (tokenInput || '').trim();
    if (!token) {
      addToast('Inserisci un token valido.', 'error');
      return;
    }
    try {
      setSyncStatus('Salvataggio token...');
      await apiFetch('/api/token', {
        method: 'POST',
        body: JSON.stringify({ token })
      });
      setTokenInput('');
      // Ricarica stato token (masked)
      try {
        const status = await fetch('/api/token/status', { credentials: 'include' });
        if (status.status === 204) {
          setMaskedToken('');
          setShowTokenPrompt(true);
        } else {
          const data = await status.json().catch(() => null);
          setMaskedToken(data?.maskedToken || '');
          setShowTokenPrompt(false);
        }
      } catch {
        // non bloccare UI
      }
      addToast('Token salvato.', 'success');
      setSyncStatus('Token salvato.');
      // opzionale: tenta refresh dati
      refreshFromBackend();
    } catch (error) {
      handleApiError(error, 'Impossibile salvare il token.');
    }
  };

  // ✅ FIX 3: definizione mancante (SettingsPanel la usa)
  const handleRequestNewToken = async () => {
    try {
      setSyncStatus('Richiesta nuovo token...');
      const data = await apiFetch('/api/token/request', { method: 'POST' });
      // Se il backend ritorna un token “in chiaro” (dipende dalla tua implementazione),
      // lo mettiamo nel campo input così lo puoi salvare subito.
      if (data?.token) {
        setTokenInput(data.token);
        addToast('Nuovo token generato. Premi "Salva token".', 'success');
      } else {
        addToast('Richiesta inviata. Controlla la risposta del server.', 'success');
      }
      setSyncStatus('Richiesta token completata.');
    } catch (error) {
      handleApiError(error, 'Impossibile richiedere un nuovo token.');
    }
  };

  const handleAddCustomer = async
