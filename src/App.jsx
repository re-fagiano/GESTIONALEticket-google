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
    }, 3000); // Rimuove il toast dopo 3 secondi
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

  const handleAddCustomer = async () => {
    if (!newCustomer.name) return;
    const customer = sanitizeCustomer({ ...newCustomer, id: crypto?.randomUUID?.() || Date.now().toString() }, customers.length);
    try {
      setIsSavingCustomer(true);
      const created = await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify(customer)
      });
      setCustomers((prev) => sanitizeCustomers([...prev, created], initialCustomers));
      setNewCustomer({ name: '', email: '', phone: '', address: '' });
      setShowNewCustomer(false);
      setSyncStatus('Cliente salvato nel backend.');
      addToast('Cliente aggiunto con successo.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile salvare il cliente.');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const handleAddTicket = async () => {
    if (!newTicket.subject || !newTicket.customerId) return;
    const ticket = sanitizeTicket({ ...newTicket, id: crypto?.randomUUID?.() || Date.now().toString() }, tickets.length);
    try {
      setIsSavingTicket(true);
      const created = await apiFetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify(ticket)
      });
      setTickets((prev) => sanitizeTickets([...prev, created], initialTickets));
      setNewTicket({ subject: '', description: '', customerId: '', status: 'aperto', date: new Date().toISOString().split('T')[0], time: '09:00' });
      setShowNewTicket(false);
      setSyncStatus('Ticket salvato nel backend.');
      addToast('Ticket creato con successo.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile salvare il ticket.');
    } finally {
      setIsSavingTicket(false);
    }
  };

  const handleAddPart = async () => {
    if (!newPart.name) return;
    const part = sanitizeInventoryItem({
      ...newPart,
      description: newPart.description || newPart.name,
      id: crypto?.randomUUID?.() || Date.now().toString()
    }, inventory.length);
    try {
      setIsSavingPart(true);
      const created = await apiFetch('/api/inventory', {
        method: 'POST',
        body: JSON.stringify(part)
      });
      setInventory((prev) => sanitizeInventoryList([...prev, created], initialInventory));
      setNewPart({ code: '', name: '', description: '', location: '', qty: 1, price: 0, minQty: 5 });
      setShowNewPart(false);
      setSyncStatus('Ricambio salvato nel backend.');
      addToast('Ricambio salvato.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile salvare il ricambio.');
    } finally {
      setIsSavingPart(false);
    }
  };

  const openTicketModal = (ticket) => {
    const safeTicket = sanitizeTicket(ticket);

    if (!safeTicket) {
      setAiError("Impossibile aprire l'intervento: dati mancanti o corrotti.");
      return;
    }

    setAiError(null);
    setAiSuggestion(null);
    setCurrentTicketForAi((prev) => (prev?.id === safeTicket.id ? null : safeTicket));
  };

  const handleTicketStatusChange = async (ticket, status) => {
    if (!ticket || ticket.status === status) return;
    const updated = {
      ...ticket,
      status,
      updatedAt: nowIso(),
      version: Number(ticket.version || 1)
    };
    try {
      const saved = await apiFetchWithRetry(`/api/tickets/${ticket.id}`, {
        method: 'PUT',
        body: JSON.stringify(updated)
      });
      setTickets((prev) => prev.map((entry) => (entry.id === ticket.id ? sanitizeTicket(saved) : entry)));
      setSyncStatus('Ticket aggiornato.');
      addToast('Stato ticket aggiornato.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile aggiornare lo stato del ticket.');
      setTickets((prev) => prev.map((entry) => (entry.id === ticket.id ? sanitizeTicket(updated) : entry)));
    }
  };

  const getStatusStyles = (status) => {
    if (status === 'chiuso') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'in lavorazione') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-600 border-red-200';
  };

  const updateStock = async (id, delta) => {
    const item = inventory.find((entry) => entry.id === id);
    if (!item) return;
    const updatedItem = {
      ...item,
      qty: Math.max(0, parseInt(item.qty) + delta),
      updatedAt: nowIso()
    };
    try {
      const saved = await apiFetchWithRetry(`/api/inventory/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updatedItem)
      });
      setInventory((prev) => prev.map((entry) => (entry.id === id ? saved : entry)));
      setSyncStatus('Magazzino aggiornato.');
      addToast('Stock aggiornato.', 'success');
    } catch (error) {
      if (error?.status === 409 && error?.payload?.current) {
        setConflictState({
          type: 'inventory',
          local: updatedItem,
          remote: error.payload.current
        });
        setStorageWarning('Conflitto magazzino: scegli la versione da mantenere.');
      } else {
        handleApiError(error, 'Impossibile aggiornare il magazzino.');
      }
    }
  };

  const resolveConflictAction = async (action) => {
    if (!conflictState) return;
    const { local, remote, type } = conflictState;
    if (type !== 'inventory') {
      setConflictState(null);
      return;
    }
    if (action === 'server') {
      setInventory((prev) => prev.map((entry) => (entry.id === remote.id ? remote : entry)));
      setConflictState(null);
      return;
    }
    const merged = action === 'merge'
      ? { ...remote, qty: Number(remote.qty) + Number(local.qty), updatedAt: nowIso() }
      : { ...local, version: remote.version };
    try {
      const saved = await apiFetch(`/api/inventory/${remote.id}`, {
        method: 'PUT',
        body: JSON.stringify(merged)
      });
      setInventory((prev) => prev.map((entry) => (entry.id === remote.id ? saved : entry)));
      setConflictState(null);
      addToast('Conflitto risolto.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile risolvere il conflitto.');
    }
  };

  const handleDelete = async (type, id) => {
    if (!confirm("Sei sicuro?")) return;
    try {
      await apiFetch(`/api/${type}/${id}`, { method: 'DELETE' });
      if (type === 'customers') setCustomers(customers.filter(c => c.id !== id));
      if (type === 'tickets') setTickets(tickets.filter(t => t.id !== id));
      if (type === 'inventory') setInventory(inventory.filter(i => i.id !== id));
      setSyncStatus('Elemento eliminato dal backend.');
      addToast('Elemento eliminato.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile eliminare l\'elemento.');
    }
  };

  const handleResetData = async () => {
    if(confirm("Reset completo dati?")) {
      try {
        await apiFetch('/api/import', {
          method: 'POST',
          body: JSON.stringify({
            force: true,
            customers: initialCustomers,
            tickets: initialTickets,
            inventory: initialInventory,
            settings: []
          })
        });
        await refreshFromBackend();
        addToast('Dati iniziali ripristinati.', 'success');
      } catch (error) {
        handleApiError(error, 'Impossibile ripristinare i dati iniziali.');
      }
    }
  };

  const exportToCsv = (filename, headers, rows) => {
    const csvContent = [headers.join(';'), ...rows.map(row => row.map(value => `"${(value ?? '').toString().replace(/"/g, '""')}"`).join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setExportNotice(`File scaricato con successo. Cerca \"${filename}\" nella cartella Download.`);
  };

  const buildBackup = () => ({
    exportedAt: new Date().toISOString(),
    customers,
    tickets,
    inventory,
    settings
  });

  const saveAutoBackup = () => {
    const backup = buildBackup();
    const payload = JSON.stringify(backup);
    const stored = safeSetItem('lastBackup', payload);
    safeSetItem('lastBackupAt', backup.exportedAt);
    if (!stored) {
      idbSet('lastBackup', payload).catch(() => null);
      idbSet('lastBackupAt', backup.exportedAt).catch(() => null);
    }
    setLatestBackup(backup);
    setAutoBackupAt(backup.exportedAt);
  };

  useEffect(() => {
    saveAutoBackup();
    const interval = setInterval(() => {
      saveAutoBackup();
    }, 600000);
    return () => clearInterval(interval);
  }, [customers, tickets, inventory, settings]);

  const handleExportTickets = () => {
    exportToCsv('tickets_export.csv',
      ['ID', 'Oggetto', 'Descrizione', 'Cliente', 'Stato', 'Data', 'Ora'],
      tickets.map(t => [t.id, t.subject, t.description, customers.find(c => c.id === t.customerId)?.name || '', t.status, t.date, t.time])
    );
  };

  const handleExportInventory = () => {
    exportToCsv('magazzino_export.csv',
      INVENTORY_HEADERS,
      inventory.map(i => [
        i.location,
        i.code,
        i.description || i.name,
        i.price,
        i.qty
      ])
    );
  };

  const handleExportCustomers = () => {
    exportToCsv('clienti_export.csv',
      ['ID', 'Nome', 'Telefono', 'Email', 'Indirizzo'],
      customers.map(c => [c.id, c.name, c.phone, c.email, c.address])
    );
  };

  const handleDownloadBackup = () => {
    const backup = buildBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'gestionale_backup.json';
    link.click();
    setExportNotice('Backup JSON scaricato con successo. Controlla la cartella Download.');
  };

  const handleDownloadAutoBackup = () => {
    if (!latestBackup) {
      setBackupStatus('Nessun backup automatico disponibile.');
      return;
    }
    const blob = new Blob([JSON.stringify(latestBackup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'gestionale_backup_auto.json';
    link.click();
  };

  const handleImportBackup = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed.customers || !parsed.tickets || !parsed.inventory) {
          throw new Error('Formato non valido');
        }
        await apiFetch('/api/import', {
          method: 'POST',
          body: JSON.stringify({
            customers: parsed.customers,
            tickets: parsed.tickets,
            inventory: parsed.inventory,
            settings: parsed.settings || []
          })
        });
        await refreshFromBackend();
        setImportError('');
      } catch (err) {
        console.error('Errore import backup', err);
        if (err?.status) {
          setImportError(err.message || 'Errore durante l\'import nel backend.');
        } else {
          setImportError('File di backup non valido. Assicurati di aver caricato un JSON generato dal Gestionale.');
        }
      }
    };
    reader.readAsText(file);
  };

  const handleRestoreLatestBackup = async () => {
    if (!latestBackup) {
      setBackupStatus('Nessun backup automatico disponibile.');
      return;
    }
    try {
      await apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify({
          customers: latestBackup.customers,
          tickets: latestBackup.tickets,
          inventory: latestBackup.inventory,
          settings: latestBackup.settings || []
        })
      });
      await refreshFromBackend();
      setBackupStatus('Backup automatico ripristinato con successo.');
      addToast('Backup automatico ripristinato.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile ripristinare il backup automatico.');
    }
  };

  const handleImportLocalData = async () => {
    try {
      await apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify({
          customers,
          tickets,
          inventory,
          settings
        })
      });
      await refreshFromBackend();
      setImportError('');
      setSyncStatus('Dati locali importati nel backend.');
      addToast('Dati locali importati.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile importare i dati locali.');
    }
  };

  const handleSelectBackupFile = () => {
    setImportError('');
    fileInputRef.current?.click();
  };

  const handlePersistStorage = async () => {
    if (!navigator?.storage?.persist) {
      setStorageWarning('Il browser non supporta la richiesta di storage persistente.');
      return;
    }
    setIsPersistingStorage(true);
    try {
      const granted = await navigator.storage.persist();
      if (granted) {
        setBackupStatus('Memoria persistente abilitata: i dati non verranno eliminati automaticamente.');
      } else {
        setBackupStatus('Memoria persistente non concessa: continua a fare backup manuali.');
      }
    } catch (error) {
      setStorageWarning('Errore durante la richiesta di storage persistente.');
    } finally {
      setIsPersistingStorage(false);
    }
  };

  const resetInventoryImportState = () => {
    setInventoryImportPreview([]);
    setInventoryImportHeaderError('');
    setShowInventoryImportModal(false);
    setIsImportingInventory(false);
  };

  const handleSelectInventoryFile = () => {
    setInventoryImportHeaderError('');
    inventoryFileInputRef.current?.click();
  };

  const handleInventoryFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImportingInventory(true);
    try {
      const existingCodes = new Set(inventory.map((item) => item.code));
      const { headerError, entries } = await parseInventoryFile(file, existingCodes);
      setInventoryImportHeaderError(headerError || '');
      setInventoryImportPreview(entries);
      setShowInventoryImportModal(true);
    } catch (error) {
      setInventoryImportHeaderError(error?.message || 'Errore durante la lettura del file.');
      setInventoryImportPreview([]);
      setShowInventoryImportModal(true);
    } finally {
      setIsImportingInventory(false);
      event.target.value = '';
    }
  };

  const applyInventoryImport = async () => {
    const validEntries = inventoryImportPreview.filter((entry) => entry.errors.length === 0);
    if (validEntries.length === 0) return;

    setIsImportingInventory(true);
    const inventoryByCode = new Map(inventory.map((item) => [item.code, item]));
    const updatedInventory = [...inventory];
    const updates = [];
    const creations = [];

    validEntries.forEach((entry) => {
      const existing = inventoryByCode.get(entry.code);
      if (existing) {
        const merged = sanitizeInventoryItem({
          ...existing,
          description: entry.description || existing.description,
          name: entry.description || existing.name,
          location: entry.location || existing.location,
          qty: Number(existing.qty) + Number(entry.quantity),
          price: entry.price ?? existing.price,
          pendingSync: !apiToken || existing.pendingSync
        });
        const existingIndex = updatedInventory.findIndex((item) => item.id === existing.id);
        if (existingIndex >= 0) {
          updatedInventory.splice(existingIndex, 1, merged);
        } else {
          updatedInventory.push(merged);
        }
        updates.push(merged);
      } else {
        const newItem = sanitizeInventoryItem({
          id: crypto?.randomUUID?.() || Date.now().toString(),
          code: entry.code,
          name: entry.description,
          description: entry.description,
          location: entry.location,
          qty: entry.quantity,
          price: entry.price,
          minQty: 0,
          pendingSync: !apiToken
        }, updatedInventory.length);
        updatedInventory.push(newItem);
        creations.push(newItem);
      }
    });

    setInventory(sanitizeInventoryList(updatedInventory, initialInventory));
    setSyncStatus(`Importazione completata: ${validEntries.length} righe valide.`);

    if (apiToken) {
      try {
        await Promise.all([
          ...creations.map((item) => apiFetch('/api/inventory', {
            method: 'POST',
            body: JSON.stringify(item)
          })),
          ...updates.map((item) => apiFetch(`/api/inventory/${item.id}`, {
            method: 'PUT',
            body: JSON.stringify(item)
          }))
        ]);
        setInventory((prev) => prev.map((item) => ({ ...item, pendingSync: false })));
        setSyncStatus('Magazzino sincronizzato con il backend.');
      } catch (error) {
        setInventory((prev) => prev.map((item) => ({
          ...item,
          pendingSync: updates.some((update) => update.id === item.id) || creations.some((create) => create.id === item.id) || item.pendingSync
        })));
        handleApiError(error, 'Errore durante la sincronizzazione del magazzino importato.');
      }
    } else {
      setSyncStatus('Import completato: articoli in attesa di sincronizzazione.');
    }

    resetInventoryImportState();
  };

  // --- GOOGLE CALENDAR LINK ---
  const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

  const getGoogleCalendarUrl = (ticket) => {
    const safeTicket = sanitizeTicket(ticket);
    if (!safeTicket) {
      console.error('Calendario: ticket non valido', ticket);
      alert('Impossibile aprire l\'intervento: dati mancanti o corrotti.');
      return null;
    }

    const customer = customers.find(c => c.id === safeTicket.customerId);

    const ensureDate = (value) => {
      if (typeof value !== 'string') return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : value;
    };

    const ensureTime = (value) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
    };

    const fallbackDateStr = new Date().toISOString().split('T')[0];
    const eventDate = ensureDate(safeTicket.date) || fallbackDateStr;
    const eventTime = ensureTime(safeTicket.time) || '09:00';

    const eventStartDate = new Date(`${eventDate}T${eventTime}`);
    if (!isValidDate(eventStartDate)) {
      console.error('Calendario: data/ora non valida', { eventDate, eventTime, ticket: safeTicket });
      alert('Impossibile creare il link del calendario: data o ora non valide.');
      return null;
    }

    const eventEndDate = new Date(eventStartDate.getTime() + 60 * 60 * 1000);
    const formatGCalDate = (value) => value.toISOString().replace(/-|:|\.\d\d\d/g, "");

    const title = encodeURIComponent(`Intervento FIXLAB: ${safeTicket.subject}`);
    const details = encodeURIComponent(`Problema: ${safeTicket.description}\nCliente: ${customer?.name}\nTel: ${customer?.phone}`);
    const location = encodeURIComponent(customer?.address || "");
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}&dates=${formatGCalDate(eventStartDate)}/${formatGCalDate(eventEndDate)}`;

    if (!url) {
      console.error('Calendario: URL non valida generata', { url, ticket: safeTicket });
      alert('Impossibile aprire Google Calendar: URL non valida.');
      return null;
    }
    return url;
  };

  // --- AI DEEPSEEK ---
  const buildOfflineSuggestion = (subject, description) => {
    const text = `${subject} ${description}`.toLowerCase();
    const suggestions = [];

    if (text.includes('lavatrice') || text.includes('wash')) {
      suggestions.push("Verifica filtro e pompa di scarico; controlla eventuali ostruzioni del tubo e ascolta se la pompa gira.");
    }
    if (text.includes('frigo') || text.includes('frigorifero') || text.includes('freddo') || text.includes('caldo')) {
      suggestions.push("Controlla condensatore pulito e ventola; verifica guarnizioni porta e temperatura corretta sul termostato.");
    }
    if (text.includes('scheda') || text.includes('elettronica')) {
      suggestions.push("Ispeziona la scheda per componenti bruciati o condensatori gonfi; valuta sostituzione modulo." );
    }
    if (text.includes('rumore') || text.includes('cuscinetti')) {
      suggestions.push("Testa i cuscinetti del cestello e verifica eventuale gioco dell'asse; sostituire se rumorosi." );
    }
    if (suggestions.length === 0) {
      suggestions.push("Esegui controllo visivo, prova alimentazione, verifica cablaggi e componenti principali prima di ordinare ricambi.");
    }

    return `Diagnosi rapida offline:\n- ${suggestions.join('\n- ')}\n- Ricambi: valuta guarnizioni, sensori, cablaggi e scheda se i test falliscono.`;
  };

  const getDeepSeekAnalysis = async (ticketDescription, ticketSubject) => {
    const hasKey = shouldUseProxy ? true : Boolean(apiKeyToUse);
    const safeSubject = (ticketSubject || '').trim() || 'Intervento senza oggetto';
    const safeDescription = (ticketDescription || '').trim() || 'Nessuna descrizione fornita.';

    if (!apiUrlToUse && !shouldUseProxy) {
      setAiError("Imposta un endpoint valido per DeepSeek (VITE_DEEPSEEK_API_URL).");
      return;
    }

    setLoadingAi(true);
    setAiSuggestion(null);
    setAiError(null);

    if (!hasKey) {
      const offline = buildOfflineSuggestion(ticketSubject, ticketDescription);
      setAiSuggestion({ text: offline, confidence: "Offline" });
      setAiError("Configura la chiave API di DeepSeek (VITE_DEEPSEEK_API_KEY) o inserisci una chiave locale nel browser.");
      setLoadingAi(false);
      return;
    }

    const systemPrompt = "Sei un tecnico esperto di elettrodomestici. Analizza il problema e fornisci: 1) Possibile Causa 2) Diagnosi 3) Ricambi.";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: `Oggetto: ${safeSubject}. Descrizione: ${safeDescription}` }], stream: false })
      });
      if (!response.ok) throw new Error(`Errore API: ${response.status}`);
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Risposta AI non valida.");
      setAiSuggestion({ text: content, confidence: shouldUseProxy || hasClientKey ? "DeepSeek AI" : "Offline" });
    } catch (error) {
      const offline = buildOfflineSuggestion(ticketSubject, ticketDescription);
      let message = error?.message || "Errore connessione AI.";
      if (message.toLowerCase().includes("failed to fetch")) {
        message = shouldUseProxy
          ? "Impossibile contattare il proxy DeepSeek (/api/deepseek). Verifica che il server sia avviato e che la variabile DEEPSEEK_API_KEY sia impostata lato backend."
          : "Impossibile contattare DeepSeek. Conferma l'endpoint (VITE_DEEPSEEK_API_URL) HTTPS e verifica che la chiave VITE_DEEPSEEK_API_KEY/DEEPSEEK_API_KEY sia presente (o incollata qui sotto).";
      }
      setAiSuggestion({ text: offline, confidence: "Offline" });
      setAiError(message);
    } finally { setLoadingAi(false); }
  };

  // --- CALENDAR HELPERS ---
  const getDaysInMonth = (date) => {
    if (!isValidDate(date)) return [];
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay(); 
    const startingDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
    const days = [];
    for (let i = 0; i < startingDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  };

  const changeMonth = (offset) => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      next.setMonth(prev.getMonth() + offset);
      return next;
    });
  };

  // --- VISTE AGGIUNTIVE ---
  
  const DashboardView = () => {
    const lowStock = inventory.filter(i => i.qty <= i.minQty);
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-slate-800">Dashboard Laboratorio</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded shadow border-l-4 border-blue-500">
            <p className="text-slate-500">Ticket Aperti</p>
            <p className="text-3xl font-bold">{tickets.filter(t => t.status === 'aperto').length}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-yellow-500">
            <p className="text-slate-500">In Lavorazione</p>
            <p className="text-3xl font-bold">{tickets.filter(t => t.status === 'in lavorazione').length}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-purple-500">
            <p className="text-slate-500">Ricambi Totali</p>
            <p className="text-3xl font-bold">{inventory.reduce((acc, item) => acc + parseInt(item.qty), 0)}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-red-500">
            <p className="text-slate-500">Scorte Basse</p>
            <p className="text-3xl font-bold text-red-600">{lowStock.length}</p>
          </div>
        </div>

        {lowStock.length > 0 && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
            <h3 className="text-red-800 font-bold flex items-center gap-2 mb-2"><AlertTriangle size={20}/> Attenzione: Scorte in esaurimento</h3>
            <ul className="list-disc list-inside text-red-700">
              {lowStock.map(item => (
                <li key={item.id}>{item.name} [{item.location || 'N/D'}] (Rimasti: <strong>{item.qty}</strong>)</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  };

  const CustomerListView = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">Rubrica Clienti</h2>
        <button onClick={() => setShowNewCustomer(true)} className="bg-green-600 text-white px-4 py-2 rounded flex gap-2"><Plus/> Nuovo Cliente</button>
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-100 uppercase text-sm font-semibold text-slate-600">
            <tr><th className="p-4">Nome</th><th className="p-4">Contatti</th><th className="p-4">Indirizzo</th><th className="p-4 text-right">Azioni</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customers.map(c => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="p-4 font-bold text-slate-800">{c.name}</td>
                <td className="p-4">
                  <div className="flex items-center gap-2 text-sm text-slate-600"><Phone size={14}/> {c.phone}</div>
                  <div className="text-xs text-slate-400">{c.email}</div>
                </td>
                <td className="p-4 text-sm text-slate-600"><MapPin size={14} className="inline mr-1"/>{c.address}</td>
                <td className="p-4 text-right"><button onClick={() => handleDelete('customers', c.id)} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={18}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const InventoryView = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800">Magazzino Ricambi</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleSelectInventoryFile} className="bg-slate-100 text-slate-700 px-4 py-2 rounded flex gap-2 items-center border disabled:opacity-60" disabled={isImportingInventory}><Upload size={18}/> {isImportingInventory ? 'Caricamento...' : 'Importa Magazzino'}</button>
          <button onClick={() => setShowNewPart(true)} className="bg-purple-600 text-white px-4 py-2 rounded flex gap-2"><Plus/> Aggiungi Articolo</button>
        </div>
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-100 uppercase text-sm font-semibold text-slate-600">
            <tr>
                <th className="p-4">Prodotto</th>
                <th className="p-4">Codice</th>
                <th className="p-4">Posizione</th>
                <th className="p-4">Prezzo</th>
                <th className="p-4 text-center">Quantità</th>
                <th className="p-4 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inventory.map(item => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="p-4 font-medium text-slate-800">
                  <div className="flex flex-col">
                    <span>{item.name}</span>
                    {item.description && item.description !== item.name && (
                      <span className="text-xs text-slate-500">{item.description}</span>
                    )}
                  </div>
                  {item.qty <= item.minQty && <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Scorta Bassa</span>}
                  {item.pendingSync && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Da sincronizzare</span>}
                </td>
                <td className="p-4 text-sm text-slate-600 font-mono">{item.code || 'N/D'}</td>
                <td className="p-4">
                    <span className="bg-slate-200 text-slate-700 text-xs font-mono font-bold px-2 py-1 rounded border border-slate-300">
                        {item.location || 'N/D'}
                    </span>
                </td>
                <td className="p-4 text-slate-600">€ {parseFloat(item.price).toFixed(2)}</td>
                <td className="p-4 text-center">
                  <div className="flex items-center justify-center gap-3">
                    <button onClick={() => updateStock(item.id, -1)} className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 font-bold">-</button>
                    <span className={`font-bold w-8 ${item.qty === 0 ? 'text-red-600' : 'text-slate-800'}`}>{item.qty}</span>
                    <button onClick={() => updateStock(item.id, 1)} className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 font-bold">+</button>
                  </div>
                </td>
                <td className="p-4 text-right"><button onClick={() => handleDelete('inventory', item.id)} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={18}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <input
        ref={inventoryFileInputRef}
        type="file"
        accept=".csv, text/csv"
        className="hidden"
        onChange={handleInventoryFileChange}
      />
    </div>
  );

  const SettingsPanel = () => (
    <div className="space-y-6">
      <div className="bg-white rounded shadow p-4 border border-slate-200">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Token API</h2>
        <p className="text-sm text-slate-500 mb-4">Gestisci il token API per l'accesso al backend. Il token viene salvato in cookie HttpOnly.</p>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            type="password"
            className="w-full border rounded p-2 text-sm"
            placeholder="Inserisci il token API"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button onClick={handleSaveToken} className="px-4 py-2 bg-slate-800 text-white rounded">Salva token</button>
          <button onClick={handleRequestNewToken} className="px-4 py-2 bg-slate-100 text-slate-700 rounded border">Richiedi nuovo token</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Token attuale: {maskedToken || 'non configurato'}.</p>
      </div>

      <div className="bg-white rounded shadow p-4 border border-slate-200">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Configurazione AI DeepSeek</h2>
        {allowLocalOverrides ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-700">Chiave DeepSeek</label>
              <input
                type="password"
                className="w-full border rounded p-2 text-sm"
                placeholder="Incolla la chiave DeepSeek"
                value={runtimeApiKey}
                onChange={(e) => setRuntimeApiKey(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700">Endpoint DeepSeek</label>
              <input
                className="w-full border rounded p-2 text-sm"
                placeholder="https://api.deepseek.com"
                value={runtimeApiUrl}
                onChange={(e) => setRuntimeApiUrl(e.target.value)}
              />
            </div>
            <p className="text-xs text-slate-500">
              Usa queste impostazioni solo per test locali. In produzione il proxy <code className="font-mono">/api/deepseek</code> gestisce le chiavi lato server.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            La configurazione AI è gestita dal server. Assicurati che <code className="font-mono">DEEPSEEK_API_KEY</code> sia impostata.
          </p>
        )}
      </div>
    </div>
  );

  const Sidebar = () => (
    <div className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-white transition-transform duration-300 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 flex flex-col`}>
      <div className="flex items-center justify-between p-4 border-b border-slate-700 h-16">
        <h1 className="text-xl font-bold flex items-center gap-2"><Zap className="w-6 h-6 text-yellow-400" /> FIXLAB AI</h1>
        <button onClick={() => setIsSidebarOpen(false)} className="md:hidden"><X className="w-6 h-6" /></button>
      </div>
      <nav className="p-4 space-y-2 flex-1">
        <button onClick={() => setActiveTab('dashboard')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'dashboard' ? 'bg-slate-800 text-yellow-400' : ''}`}><LayoutDashboard size={20}/> Dashboard</button>
        <button onClick={() => setActiveTab('tickets')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'tickets' ? 'bg-slate-800 text-yellow-400' : ''}`}><Ticket size={20}/> Ticket</button>
        <button onClick={() => setActiveTab('calendar')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'calendar' ? 'bg-slate-800 text-yellow-400' : ''}`}><Wrench size={20}/> Riparazioni</button>
        <button onClick={() => setActiveTab('customers')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'customers' ? 'bg-slate-800 text-yellow-400' : ''}`}><Users size={20}/> Clienti</button>
        <button onClick={() => setActiveTab('inventory')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'inventory' ? 'bg-slate-800 text-yellow-400' : ''}`}><Package size={20}/> Magazzino</button>
        <button onClick={() => setActiveTab('settings')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'settings' ? 'bg-slate-800 text-yellow-400' : ''}`}><Bot size={20}/> Impostazioni</button>
      </nav>
      <div className="p-4 border-t border-slate-700"><button onClick={handleResetData} className="w-full text-xs bg-red-900/50 text-red-200 p-2 rounded">Reset Dati</button></div>
    </div>
  );

  const CalendarView = () => {
    const days = getDaysInMonth(currentDate);
    const monthName = currentDate.toLocaleString('it-IT', { month: 'long', year: 'numeric' });

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center bg-white p-4 rounded shadow">
          <h2 className="text-2xl font-bold capitalize text-slate-800">{monthName}</h2>
          <div className="flex gap-2">
            <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-slate-100 rounded"><ChevronLeft/></button>
            <button onClick={() => changeMonth(1)} className="p-2 hover:bg-slate-100 rounded"><ChevronRight/></button>
            <button onClick={() => setShowNewTicket(true)} className="bg-blue-600 text-white px-4 py-2 rounded flex gap-2"><Plus/> Nuovo Intervento</button>
          </div>
        </div>

        <div className="bg-white rounded shadow p-4">
          <div className="grid grid-cols-7 gap-2 mb-2 text-center font-bold text-slate-500 uppercase text-sm">
            <div>Lun</div><div>Mar</div><div>Mer</div><div>Gio</div><div>Ven</div><div>Sab</div><div>Dom</div>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {days.map((day, idx) => {
              if (!day || !isValidDate(day)) return <div key={idx} className="bg-slate-50 h-32 rounded"></div>;
              const dayString = day.toISOString().split('T')[0];
              const dayTickets = tickets.filter(t => t.date === dayString);
              const isToday = dayString === new Date().toISOString().split('T')[0];
              return (
                <div key={idx} className={`h-32 border rounded p-2 flex flex-col gap-1 overflow-y-auto ${isToday ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <div className="text-right text-sm font-semibold text-slate-400">{day.getDate()}</div>
                  {dayTickets.map(t => (
                    <div key={t.id} onClick={() => openTicketModal(t)} className="text-xs bg-white border-l-4 border-yellow-500 p-1 rounded shadow-sm cursor-pointer hover:bg-yellow-50 truncate">
                      <span className="font-bold">{t.time}</span> {t.subject}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const handleAddCustomer = async () => {
    const payload = {
      name: newCustomer.name?.trim() || '',
      email: newCustomer.email?.trim() || '',
      phone: newCustomer.phone?.trim() || '',
      address: newCustomer.address?.trim() || ''
    };

    if (!payload.name) {
      addToast('Inserisci il nome del cliente.', 'error');
      return;
    }

    try {
      setIsSavingCustomer(true);
      const saved = await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setCustomers((prev) => [...prev, sanitizeCustomer(saved, prev.length)]);
      setNewCustomer({ name: '', email: '', phone: '', address: '' });
      addToast('Cliente salvato.', 'success');
    } catch (error) {
      if (error?.status === 401) {
        handleApiError(error, 'Impossibile salvare il cliente.');
        return;
      }
      handleApiError(error, 'Salvataggio cliente fallito, salvo in locale.');
      const fallbackCustomer = sanitizeCustomer({ ...payload, id: `${Date.now()}` }, customers.length);
      setCustomers((prev) => [...prev, fallbackCustomer]);
      addToast('Cliente salvato localmente.', 'warning');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const handleDeleteCustomer = async (id) => {
    setCustomers((prev) => prev.filter((customer) => customer.id !== id));
    try {
      await apiFetch(`/api/customers/${id}`, { method: 'DELETE' });
      addToast('Cliente eliminato.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile eliminare il cliente.');
    }
  };

  const handleAddTicket = async () => {
    const payload = {
      subject: newTicket.subject?.trim() || '',
      description: newTicket.description?.trim() || '',
      customerId: newTicket.customerId || '',
      status: newTicket.status || 'aperto',
      date: newTicket.date || '',
      time: newTicket.time || '09:00'
    };

    if (!payload.subject) {
      addToast('Inserisci l\'oggetto del ticket.', 'error');
      return;
    }

    try {
      setIsSavingTicket(true);
      const saved = await apiFetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setTickets((prev) => [...prev, sanitizeTicket(saved, prev.length)]);
      setNewTicket({
        subject: '',
        description: '',
        customerId: '',
        status: 'aperto',
        date: new Date().toISOString().split('T')[0],
        time: '09:00'
      });
      addToast('Ticket salvato.', 'success');
    } catch (error) {
      if (error?.status === 401) {
        handleApiError(error, 'Impossibile salvare il ticket.');
        return;
      }
      handleApiError(error, 'Salvataggio ticket fallito, salvo in locale.');
      const fallbackTicket = sanitizeTicket({ ...payload, id: `${Date.now()}` }, tickets.length);
      setTickets((prev) => [...prev, fallbackTicket]);
      addToast('Ticket salvato localmente.', 'warning');
    } finally {
      setIsSavingTicket(false);
    }
  };

  const handleDeleteTicket = async (id) => {
    setTickets((prev) => prev.filter((ticketItem) => ticketItem.id !== id));
    try {
      await apiFetch(`/api/tickets/${id}`, { method: 'DELETE' });
      addToast('Ticket eliminato.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile eliminare il ticket.');
    }
  };

  const handleAddPart = async () => {
    const payload = {
      code: newPart.code?.trim() || '',
      name: newPart.name?.trim() || '',
      description: newPart.description?.trim() || '',
      location: newPart.location?.trim() || '',
      qty: Number(newPart.qty) || 0,
      price: Number(newPart.price) || 0,
      minQty: Number(newPart.minQty) || 0
    };

    if (!payload.name) {
      addToast('Inserisci il nome del ricambio.', 'error');
      return;
    }

    try {
      setIsSavingPart(true);
      const saved = await apiFetch('/api/inventory', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setInventory((prev) => [...prev, sanitizeInventoryItem(saved, prev.length)]);
      setNewPart({ code: '', name: '', description: '', location: '', qty: 1, price: 0, minQty: 5 });
      addToast('Ricambio salvato.', 'success');
    } catch (error) {
      if (error?.status === 401) {
        handleApiError(error, 'Impossibile salvare il ricambio.');
        return;
      }
      handleApiError(error, 'Salvataggio ricambio fallito, salvo in locale.');
      const fallbackPart = sanitizeInventoryItem({ ...payload, id: `${Date.now()}` }, inventory.length);
      setInventory((prev) => [...prev, fallbackPart]);
      addToast('Ricambio salvato localmente.', 'warning');
    } finally {
      setIsSavingPart(false);
    }
  };

  const handleDeletePart = async (id) => {
    setInventory((prev) => prev.filter((item) => item.id !== id));
    try {
      await apiFetch(`/api/inventory/${id}`, { method: 'DELETE' });
      addToast('Ricambio eliminato.', 'success');
    } catch (error) {
      handleApiError(error, 'Impossibile eliminare il ricambio.');
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Gestionale Ticket</h1>
          <p>Gestione clienti, ticket e magazzino</p>
        </div>
        <div>
          <span className={backendOnline ? 'status-online' : 'status-offline'}>
            {backendOnline ? 'Backend online' : 'Backend offline'}
          </span>
        </div>
      </header>

      {storageWarning && <div className="warning-banner">{storageWarning}</div>}
      {syncStatus && <div className="info-banner">{syncStatus}</div>}
      {retryStatus && (
        <div className="info-banner">
          Retry {retryStatus.attempt}/{retryStatus.maxAttempts} su {retryStatus.path}
        </div>
      )}
      {conflictState && (
        <div className="warning-banner">
          Conflitto rilevato. Aggiorna i dati e riprova.
        </div>
      )}

      {showTokenPrompt && (
        <section className="token-panel">
          <h2>Token API</h2>
          <p>Inserisci il token per sincronizzare i dati con il backend.</p>
          <div className="token-actions">
            <input
              type="text"
              placeholder="Token API"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
            />
            <button type="button" onClick={handleSaveToken}>Salva token</button>
            <button type="button" onClick={handleRequestNewToken}>Richiedi token</button>
          </div>
        </section>
      )}

      {!showTokenPrompt && maskedToken && (
        <section className="token-panel">
          <h2>Token attivo</h2>
          <p>{maskedToken}</p>
        </section>
      )}

      <main className="main-grid">
        <section className="panel">
          <h2>Clienti</h2>
          <div className="form-grid">
            <input
              type="text"
              placeholder="Nome cliente"
              value={newCustomer.name}
              onChange={(event) => setNewCustomer((prev) => ({ ...prev, name: event.target.value }))}
            />
            <input
              type="email"
              placeholder="Email"
              value={newCustomer.email}
              onChange={(event) => setNewCustomer((prev) => ({ ...prev, email: event.target.value }))}
            />
            <input
              type="text"
              placeholder="Telefono"
              value={newCustomer.phone}
              onChange={(event) => setNewCustomer((prev) => ({ ...prev, phone: event.target.value }))}
            />
            <input
              type="text"
              placeholder="Indirizzo"
              value={newCustomer.address}
              onChange={(event) => setNewCustomer((prev) => ({ ...prev, address: event.target.value }))}
            />
            <button type="button" onClick={handleAddCustomer} disabled={isSavingCustomer}>
              {isSavingCustomer ? 'Salvo...' : 'Aggiungi cliente'}
            </button>
          </div>
          <ul className="list">
            {customers.map((customer) => (
              <li key={customer.id} className="list-item">
                <div>
                  <strong>{customer.name}</strong>
                  <div>{customer.email}</div>
                  <div>{customer.phone}</div>
                </div>
                <button type="button" onClick={() => handleDeleteCustomer(customer.id)}>Elimina</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Ticket</h2>
          <div className="form-grid">
            <input
              type="text"
              placeholder="Oggetto"
              value={newTicket.subject}
              onChange={(event) => setNewTicket((prev) => ({ ...prev, subject: event.target.value }))}
            />
            <textarea
              placeholder="Descrizione"
              value={newTicket.description}
              onChange={(event) => setNewTicket((prev) => ({ ...prev, description: event.target.value }))}
            />
            <select
              value={newTicket.customerId}
              onChange={(event) => setNewTicket((prev) => ({ ...prev, customerId: event.target.value }))}
            >
              <option value="">Seleziona cliente</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
            <button type="button" onClick={handleAddTicket} disabled={isSavingTicket}>
              {isSavingTicket ? 'Salvo...' : 'Aggiungi ticket'}
            </button>
          </div>
          <ul className="list">
            {tickets.map((ticketItem) => (
              <li key={ticketItem.id} className="list-item">
                <div>
                  <strong>{ticketItem.subject}</strong>
                  <div>{ticketItem.status}</div>
                </div>
                <button type="button" onClick={() => handleDeleteTicket(ticketItem.id)}>Elimina</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Magazzino</h2>
          <div className="form-grid">
            <input
              type="text"
              placeholder="Codice"
              value={newPart.code}
              onChange={(event) => setNewPart((prev) => ({ ...prev, code: event.target.value }))}
            />
            <input
              type="text"
              placeholder="Nome ricambio"
              value={newPart.name}
              onChange={(event) => setNewPart((prev) => ({ ...prev, name: event.target.value }))}
            />
            <input
              type="number"
              placeholder="Quantità"
              value={newPart.qty}
              onChange={(event) => setNewPart((prev) => ({ ...prev, qty: event.target.value }))}
            />
            <button type="button" onClick={handleAddPart} disabled={isSavingPart}>
              {isSavingPart ? 'Salvo...' : 'Aggiungi ricambio'}
            </button>
          </div>
          <ul className="list">
            {inventory.map((item) => (
              <li key={item.id} className="list-item">
                <div>
                  <strong>{item.name}</strong>
                  <div>Qta: {item.qty}</div>
                </div>
                <button type="button" onClick={() => handleDeletePart(item.id)}>Elimina</button>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>{toast.message}</div>
        ))}
      </div>
    </div>
  );
}
