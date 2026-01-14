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
    setCurrentTicketForAi(safeTicket);
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

  const handleDownloadLatestBackup = () => {
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

  const SettingsView = () => (
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
        <button onClick={() => setActiveTab('calendar')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'calendar' ? 'bg-slate-800 text-yellow-400' : ''}`}><CalendarIcon size={20}/> Calendario</button>
        <button onClick={() => setActiveTab('tickets')} className={`flex items-center gap-3 w-full p-3 rounded hover:bg-slate-800 ${activeTab === 'tickets' ? 'bg-slate-800 text-yellow-400' : ''}`}><Ticket size={20}/> Lista Ticket</button>
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

  const validInventoryImportCount = inventoryImportPreview.filter((entry) => entry.errors.length === 0).length;
  const hasInventoryImportErrors = Boolean(inventoryImportHeaderError) || inventoryImportPreview.some((entry) => entry.errors.length > 0);

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm z-30 p-4 flex justify-between items-center md:hidden">
           <span className="font-bold text-slate-700 flex items-center gap-2"><Zap className="text-yellow-500 w-5 h-5"/> FIXLAB</span>
           <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}><Menu className="w-6 h-6 text-slate-600" /></button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto pb-20">
            {storageWarning && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 rounded mb-4">
                {storageWarning}
              </div>
            )}
            {exportNotice && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-3 rounded mb-4">
                {exportNotice}
              </div>
            )}
            <div className="bg-white rounded shadow p-4 mb-6 border border-slate-200">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><Zap size={16}/> Backend &amp; sincronizzazione</p>
                  <p className="text-xs text-slate-500">Imposta il token per accedere alle API e aggiorna il database con i dati locali quando necessario.</p>
                  <p className={`text-xs ${backendOnline ? 'text-emerald-600' : 'text-red-600'}`}>
                    {backendOnline ? 'Backend online' : 'Backend offline: modalità locale attiva'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={refreshFromBackend} className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 border" disabled={isSyncing}>
                    <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''}/> Aggiorna da backend
                  </button>
                  <button onClick={handleImportLocalData} className="flex items-center gap-2 px-3 py-2 text-sm bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 border border-emerald-200"><Upload size={16}/> Importa dati locali</button>
                </div>
              </div>
              {retryStatus && (
                <div className="mt-3 text-xs text-slate-500">
                  Retry in corso ({retryStatus.attempt}/{retryStatus.maxAttempts}) per {retryStatus.path}.
                  <div className="mt-1 h-1 bg-slate-200 rounded">
                    <div
                      className="h-1 bg-blue-500 rounded"
                      style={{ width: `${Math.round((retryStatus.attempt / retryStatus.maxAttempts) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-slate-700">Token API</label>
                  <div className="text-sm text-slate-600">
                    {maskedToken ? `Token configurato: ${maskedToken}` : 'Token non configurato.'}
                  </div>
                  <button onClick={() => setActiveTab('settings')} className="text-xs text-blue-600 underline w-fit">Gestisci token</button>
                </div>
                <div className="text-xs text-slate-500 flex items-center">
                  {syncStatus || 'Sincronizzazione pronta.'}
                </div>
              </div>
            </div>
            <div className="bg-white rounded shadow p-4 mb-6 border border-slate-200">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><FileSpreadsheet size={16}/> Backup e Export</p>
                  <p className="text-xs text-slate-500">Scarica un JSON di backup per conservarlo su Drive/Cloud, oppure esporta CSV apribili in Excel per storico o assenza di connessione.</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <button onClick={handleDownloadBackup} className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-800 text-white rounded hover:bg-slate-700"><Download size={16}/> Backup JSON</button>
                  <button onClick={handleDownloadLatestBackup} className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 border"><Download size={16}/> Ultimo Backup</button>
                  <button onClick={handleRestoreLatestBackup} className="flex items-center gap-2 px-3 py-2 text-sm bg-amber-50 text-amber-700 rounded hover:bg-amber-100 border border-amber-200">Ripristina Backup</button>
                  <button onClick={handleSelectBackupFile} className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 border"><Upload size={16}/> Importa Backup</button>
                  <button onClick={handlePersistStorage} className="flex items-center gap-2 px-3 py-2 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-500" disabled={isPersistingStorage}>
                    {isPersistingStorage ? <RefreshCw size={16} className="animate-spin"/> : <Download size={16}/>} Blocca dati nel browser
                  </button>
                  <button onClick={handleExportTickets} className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100 border border-blue-200"><FileSpreadsheet size={16}/> Ticket CSV</button>
                  <button onClick={handleExportInventory} className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-50 text-purple-700 rounded hover:bg-purple-100 border border-purple-200"><FileSpreadsheet size={16}/> Magazzino CSV</button>
                  <button onClick={handleExportCustomers} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-50 text-green-700 rounded hover:bg-green-100 border border-green-200"><FileSpreadsheet size={16}/> Clienti CSV</button>
                  <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportBackup} />
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Backup automatico: {autoBackupAt ? `ultimo salvataggio ${autoBackupAt}` : 'non disponibile'}.
              </div>
              {backupStatus && <p className="mt-2 text-xs text-amber-600">{backupStatus}</p>}
              {importError && <p className="mt-2 text-sm text-red-600">{importError}</p>}
            </div>
            {activeTab === 'dashboard' && <DashboardView />}
            {activeTab === 'calendar' && <CalendarView />}
            {activeTab === 'customers' && <CustomerListView />}
            {activeTab === 'inventory' && <InventoryView />}
            {activeTab === 'settings' && <SettingsView />}
            
            {activeTab === 'tickets' && (
                <div className="space-y-6">
                    <div className="flex justify-between"><h2 className="text-2xl font-bold">Tutti i Ticket</h2><button onClick={() => setShowNewTicket(true)} className="bg-blue-600 text-white px-4 py-2 rounded flex gap-2"><Plus/> Nuovo</button></div>
                    <div className="bg-white rounded shadow overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-100"><tr><th className="p-4">Data</th><th className="p-4">Problema</th><th className="p-4">Stato</th><th className="p-4 text-right">Azioni</th></tr></thead>
                            <tbody>
                                {tickets.map(t => (
                                    <tr key={t.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => openTicketModal(t)}>
                                        <td className="p-4 text-sm"><div className="font-bold">{t.date}</div><div className="text-slate-500">{t.time}</div></td>
                                        <td className="p-4"><div className="font-bold">{t.subject}</div><div className="text-xs text-slate-500">{t.description}</div></td>
                                        <td className="p-4"><span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">{t.status}</span></td>
                                        <td className="p-4 text-right flex justify-end gap-2">
                                            <a
                                              href={getGoogleCalendarUrl(t) || '#'}
                                              onClick={(e) => {
                                                if (!getGoogleCalendarUrl(t)) e.preventDefault();
                                                e.stopPropagation();
                                              }}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-green-600 hover:bg-green-50 p-1 rounded"
                                            >
                                              <CalendarIcon size={18}/>
                                            </a>
                                            <button onClick={(e) => {e.stopPropagation(); handleDelete('tickets', t.id)}} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={18}/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {currentTicketForAi && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-2xl font-bold flex items-center gap-2"><Wrench className="text-blue-600"/> {currentTicketForAi.subject}</h3>
                                <p className="text-slate-500 text-sm">Intervento del {currentTicketForAi.date || 'data non disponibile'} alle {currentTicketForAi.time || '--:--'}</p>
                            </div>
                            <button onClick={() => setCurrentTicketForAi(null)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
                        </div>
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="bg-slate-50 p-4 rounded border"><h4 className="font-bold text-sm text-slate-700 uppercase mb-2">Dettagli Problema</h4><p className="text-slate-700">{currentTicketForAi.description}</p></div>
                                <a
                                  href={getGoogleCalendarUrl(currentTicketForAi) || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="w-full py-3 bg-white border-2 border-green-500 text-green-600 font-bold rounded hover:bg-green-50 flex items-center justify-center gap-2"
                                >
                                  <CalendarIcon/> Salva su Google Calendar
                                </a>
                            </div>
                            <div className="space-y-4">
                                <div className="bg-indigo-50 p-4 rounded border border-indigo-100">
                                    <h4 className="font-bold text-sm text-indigo-800 uppercase mb-2 flex items-center gap-2"><Bot size={16}/> Diagnosi AI</h4>
                                    {aiError && <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded">{aiError}</div>}
                                    <div className="bg-white border border-indigo-100 p-3 rounded text-xs text-slate-600 space-y-2 mb-3">
                                      <p className="font-semibold text-slate-800 flex items-center justify-between">
                                        <span>Configurazione AI</span>
                                        <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">
                                          {keyModeLabel}
                                        </span>
                                      </p>
                                      {allowLocalOverrides ? (
                                        <p>
                                          Configura la chiave DeepSeek nella sezione <button onClick={() => setActiveTab('settings')} className="text-indigo-600 underline">Impostazioni</button>.
                                        </p>
                                      ) : (
                                        <p>
                                          Il proxy backend gestisce la chiave DeepSeek. Se l'AI non risponde, verifica la configurazione server.
                                        </p>
                                      )}
                                    </div>
                                    {!aiEnabled && (
                                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">
                                        AI non configurata: imposta la chiave nelle impostazioni o verifica il proxy backend.
                                      </div>
                                    )}
                                    {aiSuggestion ? (
                                      <div className="text-sm whitespace-pre-line text-slate-700">{aiSuggestion.text}</div>
                                    ) : loadingAi ? (
                                      <div className="flex items-center gap-2 text-indigo-600"><RefreshCw className="animate-spin"/> Analisi in corso...</div>
                                    ) : (
                                      <button
                                        onClick={() => getDeepSeekAnalysis(currentTicketForAi.description, currentTicketForAi.subject)}
                                        className="bg-indigo-600 text-white px-4 py-2 rounded text-sm w-full disabled:bg-indigo-300"
                                        disabled={!aiEnabled}
                                      >
                                        Avvia Analisi DeepSeek
                                      </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
          </div>
        </main>
      </div>

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-4 py-2 rounded shadow text-sm ${
                toast.tone === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}

      {conflictState && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-lg w-full max-w-lg">
            <h3 className="text-lg font-bold mb-2">Conflitto dati</h3>
            <p className="text-sm text-slate-500 mb-4">Il backend ha una versione diversa. Scegli quale mantenere.</p>
            <div className="grid gap-3 md:grid-cols-2 text-xs">
              <div className="border rounded p-2">
                <p className="font-semibold mb-1">Versione locale</p>
                <pre className="whitespace-pre-wrap">{JSON.stringify(conflictState.local, null, 2)}</pre>
              </div>
              <div className="border rounded p-2">
                <p className="font-semibold mb-1">Versione server</p>
                <pre className="whitespace-pre-wrap">{JSON.stringify(conflictState.remote, null, 2)}</pre>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => resolveConflictAction('server')} className="px-4 py-2 text-slate-600">Usa server</button>
              <button onClick={() => resolveConflictAction('merge')} className="px-4 py-2 bg-amber-100 text-amber-700 rounded">Unisci</button>
              <button onClick={() => resolveConflictAction('local')} className="px-4 py-2 bg-blue-600 text-white rounded">Usa locale</button>
            </div>
          </div>
        </div>
      )}
      
      {showInventoryImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <h3 className="text-xl font-bold mb-4">Anteprima Importazione Magazzino</h3>
            {inventoryImportHeaderError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded">
                {inventoryImportHeaderError}
              </div>
            ) : (
              <div className="flex-1 overflow-auto border rounded">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 uppercase text-xs font-semibold text-slate-600 sticky top-0">
                    <tr>
                      <th className="p-3">Riga</th>
                      <th className="p-3">Codice</th>
                      <th className="p-3">Descrizione</th>
                      <th className="p-3">Posizione</th>
                      <th className="p-3 text-right">Prezzo</th>
                      <th className="p-3 text-right">Quantità</th>
                      <th className="p-3">Stato</th>
                      <th className="p-3">Errori</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventoryImportPreview.map((row) => (
                      <tr key={`${row.code}-${row.rowIndex}`} className={row.errors.length ? 'bg-red-50' : ''}>
                        <td className="p-3 text-slate-500">{row.rowIndex}</td>
                        <td className="p-3 font-mono text-slate-700">{row.code || '-'}</td>
                        <td className="p-3 text-slate-700">{row.description || '-'}</td>
                        <td className="p-3 text-slate-700">{row.location || 'N/D'}</td>
                        <td className="p-3 text-right">{row.price ?? '-'}</td>
                        <td className="p-3 text-right">{row.quantity ?? '-'}</td>
                        <td className="p-3">
                          <span className={`text-xs px-2 py-0.5 rounded ${row.status === 'update' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {row.status === 'update' ? 'Aggiorna' : 'Nuovo'}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-red-700">{row.errors.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
              <span>{validInventoryImportCount} righe valide</span>
              {hasInventoryImportErrors && !inventoryImportHeaderError && (
                <span className="text-red-600">Correggi le righe evidenziate prima di importare.</span>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetInventoryImportState} className="px-4 py-2 text-slate-500" disabled={isImportingInventory}>Annulla</button>
              <button
                onClick={applyInventoryImport}
                className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-60"
                disabled={isImportingInventory || Boolean(inventoryImportHeaderError) || validInventoryImportCount === 0 || hasInventoryImportErrors}
              >
                {isImportingInventory ? 'Importazione...' : 'Conferma Importazione'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewTicket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Nuovo Intervento</h3>
                <div className="space-y-3">
                    <select className="w-full border p-2 rounded" value={newTicket.customerId} onChange={e => setNewTicket({...newTicket, customerId: e.target.value})}>
                        <option value="">Seleziona Cliente...</option>
                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input className="w-full border p-2 rounded" placeholder="Elettrodomestico / Problema" value={newTicket.subject} onChange={e => setNewTicket({...newTicket, subject: e.target.value})} />
                    <div className="flex gap-2">
                        <input type="date" className="w-full border p-2 rounded" value={newTicket.date} onChange={e => setNewTicket({...newTicket, date: e.target.value})} />
                        <input type="time" className="w-full border p-2 rounded" value={newTicket.time} onChange={e => setNewTicket({...newTicket, time: e.target.value})} />
                    </div>
                    <textarea className="w-full border p-2 rounded" placeholder="Descrizione dettagliata (per AI)" value={newTicket.description} onChange={e => setNewTicket({...newTicket, description: e.target.value})} />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowNewTicket(false)} className="px-4 py-2 text-slate-500">Annulla</button>
                  <button onClick={handleAddTicket} className="px-4 py-2 bg-blue-600 text-white rounded flex items-center gap-2" disabled={isSavingTicket}>
                    {isSavingTicket && <RefreshCw size={16} className="animate-spin"/>} Salva
                  </button>
                </div>
            </div>
        </div>
      )}

      {showNewCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Nuovo Cliente</h3>
                <div className="space-y-3">
                    <input className="w-full border p-2 rounded" placeholder="Nome Completo" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Telefono" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Email" value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Indirizzo" value={newCustomer.address} onChange={e => setNewCustomer({...newCustomer, address: e.target.value})} />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowNewCustomer(false)} className="px-4 py-2 text-slate-500">Annulla</button>
                  <button onClick={handleAddCustomer} className="px-4 py-2 bg-green-600 text-white rounded flex items-center gap-2" disabled={isSavingCustomer}>
                    {isSavingCustomer && <RefreshCw size={16} className="animate-spin"/>} Salva
                  </button>
                </div>
            </div>
        </div>
      )}

      {showNewPart && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Nuovo Articolo Magazzino</h3>
                <div className="space-y-3">
                    <input className="w-full border p-2 rounded" placeholder="Codice Articolo (es. RIC-001)" value={newPart.code} onChange={e => setNewPart({...newPart, code: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Nome Prodotto (es. Cuscinetti)" value={newPart.name} onChange={e => setNewPart({...newPart, name: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Descrizione (opzionale)" value={newPart.description} onChange={e => setNewPart({...newPart, description: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Codice Posizione (es. af00021)" value={newPart.location} onChange={e => setNewPart({...newPart, location: e.target.value})} />
                    <div className="flex gap-2">
                        <input type="number" className="w-full border p-2 rounded" placeholder="Quantità" value={newPart.qty} onChange={e => setNewPart({...newPart, qty: parseInt(e.target.value)})} />
                        <input type="number" className="w-full border p-2 rounded" placeholder="Prezzo (€)" value={newPart.price} onChange={e => setNewPart({...newPart, price: parseFloat(e.target.value)})} />
                    </div>
                    <input type="number" className="w-full border p-2 rounded" placeholder="Quantità Minima (Allarme)" value={newPart.minQty} onChange={e => setNewPart({...newPart, minQty: parseInt(e.target.value)})} />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowNewPart(false)} className="px-4 py-2 text-slate-500">Annulla</button>
                  <button onClick={handleAddPart} className="px-4 py-2 bg-purple-600 text-white rounded flex items-center gap-2" disabled={isSavingPart}>
                    {isSavingPart && <RefreshCw size={16} className="animate-spin"/>} Salva
                  </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
