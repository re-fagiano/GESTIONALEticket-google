import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Menu,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Phone,
  MapPin,
  Download,
  Upload,
  FileSpreadsheet,
  Bot,
  Plus,
  Zap
} from 'lucide-react';
import { INVENTORY_HEADERS, parseInventoryFile } from './utils/inventoryImport';
import {
  apiFetch as apiFetchRequest,
  apiFetchWithRetry as apiFetchWithRetryRequest,
  callDeepSeekApi,
  getHealthStatus,
  getTokenStatus,
  logout,
  requestNewToken,
  saveToken
} from './services/api';
import {
  getStorageState,
  idbSet,
  loadBackupAtFromIdb,
  loadBackupAtSync,
  loadBackupFromIdb,
  loadBackupSync,
  loadCache,
  loadCacheFromIdb,
  readRawSync,
  saveBackup,
  saveCache,
  writeRaw
} from './services/clientStorage';
import Sidebar from './components/Sidebar';
import ToastList from './components/ToastList';
import ActiveTabContent from './pages/ActiveTabContent';
import {
  isBrowser,
  isLocalhost,
  forcedProxyEndpoint,
  nowIso,
  toDateKey,
  toLocalDateTimeInput,
  generateUserCode,
  formatAuditDate,
  getDescriptionEntries,
  buildDescriptionFromEntries,
  sanitizeTicket,
  sanitizeTickets,
  sanitizeCustomer,
  sanitizeCustomers,
  sanitizeInventoryItem,
  sanitizeInventoryList,
  interventionTypes,
  interventionStatuses,
  interventionTypeMeta,
  dedicatedTabToType,
  mapTicketStatusToInterventionStatus,
  interventionToTicket,
  sanitizeIntervention,
  sanitizeInterventions,
  parseCsvRows,
  initialCustomers,
  initialTickets,
  initialInventory,
  initialInterventions,
} from './app/appData';

export default function App() {
  const [activeTab, setActiveTab] = useState('calendar'); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // --- STATO CALENDARIO ---
  const calendarRef = useRef(null);
  const calendarApiRef = useRef(null);
  const [showCalendarQuickAdd, setShowCalendarQuickAdd] = useState(false);

  // --- STATO APP ---
  const [customers, setCustomers] = useState(() => sanitizeCustomers(loadCache('customers', initialCustomers), initialCustomers));
  const [tickets, setTickets] = useState(() => sanitizeTickets(loadCache('tickets', initialTickets), initialTickets));
  const [interventions, setInterventions] = useState(() => sanitizeInterventions(loadCache('interventions', initialInterventions), initialInterventions));
  const [inventory, setInventory] = useState(() => sanitizeInventoryList(loadCache('inventory', initialInventory), initialInventory));
  const [settings, setSettings] = useState(() => loadCache('settings', []));
  const [storageWarning, setStorageWarning] = useState(null);
  const [conflictState, setConflictState] = useState(null);
  const [apiToken, setApiToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [maskedToken, setMaskedToken] = useState('');
  const [currentRole, setCurrentRole] = useState('');
  const [showTokenPrompt, setShowTokenPrompt] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [exportNotice, setExportNotice] = useState(null);
  // Stato di connettività del backend (assume offline di default)
  const [backendOnline, setBackendOnline] = useState(false);

  // Stato per i messaggi di retry quando le chiamate API falliscono
  const [retryStatus, setRetryStatus] = useState('');

  // Stato per l’ultimo backup automatico e relativo timestamp
  const [latestBackup, setLatestBackup] = useState(() => loadBackupSync());
  const [autoBackupAt, setAutoBackupAt] = useState(() => loadBackupAtSync());

  // Stato per la notifica dei backup manuali/automatici
  const [backupStatus, setBackupStatus] = useState('');
  const [mbiEnabled] = useState(false);
  const [, setMbiStatus] = useState('');

  // Stato che indica se la storage persistente è in fase di richiesta
  const [isPersistingStorage, setIsPersistingStorage] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Stato per le notifiche toast
  const [toasts, setToasts] = useState([]);

  const [operatorProfile, setOperatorProfile] = useState(() => {
    const savedCode = readRawSync('operatorCode', '');
    const savedName = readRawSync('operatorName', '');
    return {
      code: savedCode || generateUserCode(),
      name: savedName || 'Operatore'
    };
  });

  const interventionTickets = useMemo(() => (
    sanitizeInterventions(interventions, initialInterventions).map((entry, idx) => interventionToTicket(entry, idx))
  ), [interventions]);

  const ticketsById = useMemo(() => new Map(tickets.map((ticket) => [ticket.id, sanitizeTicket(ticket)])), [tickets]);

  const displayedTickets = useMemo(() => {
    const merged = [...interventionTickets];
    ticketsById.forEach((ticket, id) => {
      if (!merged.some((entry) => entry.id === id)) merged.push(ticket);
    });
    return merged.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }, [interventionTickets, ticketsById]);

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
    if (!saveCache('interventions', sanitizeInterventions(interventions, initialInterventions))) {
      setStorageWarning('Impossibile salvare gli interventi nel browser: storage disabilitato.');
    }
  }, [interventions]);

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
    writeRaw('operatorCode', operatorProfile.code);
    writeRaw('operatorName', operatorProfile.name);
  }, [operatorProfile]);

  useEffect(() => {
    const storageState = getStorageState();
    if (!storageState.localStorageAvailable || storageState.fallbackActive) {
      const loadFallback = async () => {
        try {
          const [customersRaw, ticketsRaw, interventionsRaw, inventoryRaw, settingsRaw, backupRaw, backupAt] = await Promise.all([
            loadCacheFromIdb('customers', initialCustomers),
            loadCacheFromIdb('tickets', initialTickets),
            loadCacheFromIdb('interventions', initialInterventions),
            loadCacheFromIdb('inventory', initialInventory),
            loadCacheFromIdb('settings', []),
            loadBackupFromIdb(),
            loadBackupAtFromIdb(),
          ]);
          if (customersRaw) setCustomers(sanitizeCustomers(customersRaw, initialCustomers));
          if (ticketsRaw) setTickets(sanitizeTickets(ticketsRaw, initialTickets));
          if (interventionsRaw) setInterventions(sanitizeInterventions(interventionsRaw, initialInterventions));
          if (inventoryRaw) setInventory(sanitizeInventoryList(inventoryRaw, initialInventory));
          if (settingsRaw) setSettings(Array.isArray(settingsRaw) ? settingsRaw : []);
          if (backupRaw) setLatestBackup(backupRaw);
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
        const data = await getTokenStatus();
        if (!data) {
          setShowTokenPrompt(true);
          return;
        }
        if (data?.maskedToken) {
          setMaskedToken(data.maskedToken);
          setCurrentRole(data?.user?.role || '');
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
  const endpoint = forcedProxyEndpoint;

  const apiFetch = (path, options = {}) => apiFetchRequest(path, options, apiToken);
  const apiFetchWithRetry = (path, options = {}) => apiFetchWithRetryRequest(path, options, { apiToken, onRetryStatus: setRetryStatus });
  const requestHeaders = {
    'Content-Type': 'application/json',
  };
  const aiEnabled = true;

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
      setInterventions(sanitizeInterventions(data.interventions, initialInterventions));
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
        const isHealthy = await getHealthStatus();
        setBackendOnline(isHealthy);
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


  // Forms
  const [newCustomer, setNewCustomer] = useState({ name: '', email: '', phone: '', address: '' });
  const [newTicket, setNewTicket] = useState({
    subject: '', description: '', customerId: '', status: 'aperto', type: 'chiamata', urgency: 2,
    date: new Date().toISOString().split('T')[0], time: '09:00'
  });
  const [newIntervention, setNewIntervention] = useState({
    clientId: '',
    type: 'chiamata',
    status: 'pendente',
    urgency: 2,
    openedAt: nowIso(),
    description: '',
    parentInterventionId: '',
    applianceBrand: '',
    applianceModel: '',
    serialNumber: '',
    defect: '',
    sparePartCode: '',
    sparePartQty: 1,
    supplier: '',
    quoteItems: '',
    quoteTotal: 0,
    quoteValidUntil: ''
  });
  const [newPart, setNewPart] = useState({ code: '', name: '', description: '', location: '', qty: 1, price: 0, minQty: 5, priceDate: new Date().toISOString().split('T')[0] });
  const [ticketCustomerQuery, setTicketCustomerQuery] = useState('');
  const [interventionCustomerQuery, setInterventionCustomerQuery] = useState('');
  const [returnToTicketAfterCustomer, setReturnToTicketAfterCustomer] = useState(false);
  const [returnToInterventionAfterCustomer, setReturnToInterventionAfterCustomer] = useState(false);
  const [newInterventionFiles, setNewInterventionFiles] = useState([]);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);
  const inventoryFileInputRef = useRef(null);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [isSavingTicket, setIsSavingTicket] = useState(false);
  const [isSavingPart, setIsSavingPart] = useState(false);
  const [inventoryImportPreview, setInventoryImportPreview] = useState([]);
  const [inventoryImportHeaderError, setInventoryImportHeaderError] = useState('');
  const [showInventoryImportModal, setShowInventoryImportModal] = useState(false);
  const [isImportingInventory, setIsImportingInventory] = useState(false);
  const [interventionSearch, setInterventionSearch] = useState('');
  const [interventionFilters, setInterventionFilters] = useState({ clientId: '', type: '', status: '', urgency: '' });
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventorySearchField, setInventorySearchField] = useState('all');
  const [selectedIntervention, setSelectedIntervention] = useState(null);
  const openInterventions = interventions.filter((item) => item.status !== 'chiuso');
  const normalizedTicketCustomerQuery = ticketCustomerQuery.trim().toLowerCase();
  const filteredTicketCustomers = customers.filter((customer) => {
    if (!normalizedTicketCustomerQuery) return true;
    const searchable = `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase();
    return searchable.includes(normalizedTicketCustomerQuery);
  });
  const normalizedInterventionCustomerQuery = interventionCustomerQuery.trim().toLowerCase();
  const filteredInterventionCustomers = customers.filter((customer) => {
    if (!normalizedInterventionCustomerQuery) return true;
    const searchable = `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase();
    return searchable.includes(normalizedInterventionCustomerQuery);
  });
  const normalizedInventorySearch = inventorySearch.trim().toLowerCase();
  const filteredInventory = inventory.filter((item) => {
    if (!normalizedInventorySearch) return true;

    const fields = {
      name: item.name,
      code: item.code,
      description: item.description,
      location: item.location,
      price: Number(item.price).toFixed(2),
      priceDate: item.priceDate ? new Date(item.priceDate).toLocaleDateString('it-IT') : '',
      qty: String(item.qty),
      minQty: String(item.minQty)
    };
    const searchable = inventorySearchField === 'all'
      ? Object.values(fields).join(' ')
      : fields[inventorySearchField] || '';

    return searchable.toLowerCase().includes(normalizedInventorySearch);
  });

  const switchToTab = (tab) => {
    setActiveTab(tab);
    const mappedType = dedicatedTabToType[tab];
    if (mappedType) {
      setNewIntervention((prev) => ({ ...prev, type: mappedType }));
    }
  };

  const openInterventionComposer = (scheduledAt = null, type = 'chiamata', options = {}) => {
    setNewIntervention((prev) => ({
      ...prev,
      type,
      openedAt: scheduledAt || prev.openedAt || nowIso()
    }));
    if (options.keepCalendarOpen) {
      setShowCalendarQuickAdd(true);
      return;
    }
    switchToTab('interventions');
  };

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

  const shouldFallbackToLocal = (error) => {
    const status = Number(error?.status);
    return !status || status === 401 || status === 403 || status >= 500;
  };

  const handleSaveToken = async () => {
    const trimmedToken = tokenInput.trim();
    if (!trimmedToken) {
      addToast('Inserisci un token valido.', 'error');
      return;
    }
    try {
      setSyncStatus('Salvataggio token...');
      const data = await saveToken(trimmedToken);
      setApiToken(data?.accessToken || '');
      setMaskedToken(data?.maskedToken || '');
      setCurrentRole(data?.role || '');
      setTokenInput('');
      setShowTokenPrompt(false);
      setStorageWarning(null);
      setSyncStatus('Token salvato.');
      addToast('Token salvato con successo.', 'success');
    } catch (error) {
      setSyncStatus(null);
      handleApiError(error, 'Impossibile salvare il token.');
    }
  };

  const handleRequestNewToken = async () => {
    try {
      setSyncStatus('Richiesta nuovo token...');
      const data = await requestNewToken();
      setApiToken(data?.token || '');
      setMaskedToken(data?.maskedToken || '');
      setTokenInput(data?.token || '');
      setShowTokenPrompt(false);
      setStorageWarning(null);
      setSyncStatus('Nuovo token generato.');
      addToast('Nuovo token generato. Copialo e salvalo al sicuro.', 'success');
    } catch (error) {
      setSyncStatus(null);
      handleApiError(error, 'Impossibile richiedere un nuovo token.');
    }
  };

  const handleLogout = async () => {
    await logout().catch(() => null);
    setApiToken('');
    setMaskedToken('');
    setCurrentRole('');
    setShowTokenPrompt(true);
    addToast('Logout effettuato.', 'success');
  };

  const handleCreateCustomer = async () => {
    if (!newCustomer.name.trim()) {
      addToast('Inserisci almeno il nome cliente.', 'error');
      return;
    }
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
      if (returnToTicketAfterCustomer) {
        setShowNewTicket(true);
        setNewTicket((prev) => ({ ...prev, customerId: created.id }));
        setReturnToTicketAfterCustomer(false);
      }
      if (returnToInterventionAfterCustomer) {
        setNewIntervention((prev) => ({ ...prev, clientId: created.id }));
        setReturnToInterventionAfterCustomer(false);
      }
      setSyncStatus('Cliente salvato nel backend.');
      addToast('Cliente aggiunto con successo.', 'success');
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        setCustomers((prev) => sanitizeCustomers([...prev, customer], initialCustomers));
        setShowNewCustomer(false);
        if (returnToTicketAfterCustomer) {
          setShowNewTicket(true);
          setNewTicket((prev) => ({ ...prev, customerId: customer.id }));
          setReturnToTicketAfterCustomer(false);
        }
        if (returnToInterventionAfterCustomer) {
          setNewIntervention((prev) => ({ ...prev, clientId: customer.id }));
          setReturnToInterventionAfterCustomer(false);
        }
        addToast('Cliente salvato in locale (token mancante/non valido).', 'success');
        setSyncStatus('Modalità locale: cliente salvato solo nel browser.');
      } else {
        handleApiError(error, 'Impossibile salvare il cliente.');
      }
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!newTicket.customerId) {
      addToast('Seleziona un cliente prima di salvare il ticket.', 'error');
      return;
    }
    if (!newTicket.subject.trim()) {
      addToast("Inserisci l'oggetto/problema del ticket.", 'error');
      return;
    }
    const ticket = sanitizeTicket({ ...newTicket, id: crypto?.randomUUID?.() || Date.now().toString() }, tickets.length);
    try {
      setIsSavingTicket(true);
      const created = await apiFetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify(ticket)
      });
      setTickets((prev) => sanitizeTickets([...prev, created], initialTickets));
      setNewTicket({ subject: '', description: '', customerId: '', status: 'aperto', type: 'chiamata', urgency: 2, date: new Date().toISOString().split('T')[0], time: '09:00' });
      setShowNewTicket(false);
      setSyncStatus('Ticket salvato nel backend.');
      addToast('Ticket creato con successo.', 'success');
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        setTickets((prev) => sanitizeTickets([...prev, ticket], initialTickets));
        setNewTicket({ subject: '', description: '', customerId: '', status: 'aperto', type: 'chiamata', urgency: 2, date: new Date().toISOString().split('T')[0], time: '09:00' });
        setTicketCustomerQuery('');
        setShowNewTicket(false);
        addToast('Ticket salvato in locale (token mancante/non valido).', 'success');
        setSyncStatus('Modalità locale: ticket salvato solo nel browser.');
      } else {
        handleApiError(error, 'Impossibile salvare il ticket.');
      }
    } finally {
      setIsSavingTicket(false);
    }
  };

  const handleAddIntervention = async (forcedType = null) => {
    const selectedType = forcedType || newIntervention.type;
    if (!newIntervention.clientId) {
      addToast('Seleziona un cliente prima di salvare l\'intervento.', 'error');
      return;
    }
    if (!selectedType) {
      addToast('Seleziona il tipo intervento.', 'error');
      return;
    }
    const additionalData = {};
    if (selectedType === 'riparazione') {
      additionalData.applianceBrand = newIntervention.applianceBrand;
      additionalData.applianceModel = newIntervention.applianceModel;
      additionalData.serialNumber = newIntervention.serialNumber;
      additionalData.defect = newIntervention.defect;
    }
    if (selectedType === 'ordine_ricambi') {
      additionalData.sparePartCode = newIntervention.sparePartCode;
      additionalData.quantity = Number(newIntervention.sparePartQty || 1);
      additionalData.supplier = newIntervention.supplier;
    }
    if (selectedType === 'preventivo') {
      additionalData.quoteItems = newIntervention.quoteItems;
      additionalData.quoteTotal = Number(newIntervention.quoteTotal || 0);
      additionalData.quoteValidUntil = newIntervention.quoteValidUntil;
    }

    const descriptionEntries = (newIntervention.description || '').trim()
      ? [{
          id: crypto?.randomUUID?.() || `${Date.now()}`,
          text: newIntervention.description.trim(),
          authorCode: operatorProfile.code,
          authorName: operatorProfile.name || 'Operatore',
          createdAt: nowIso(),
          source: 'original'
        }]
      : [];

    additionalData.descriptionEntries = descriptionEntries;

    const payload = sanitizeIntervention({
      id: crypto?.randomUUID?.() || Date.now().toString(),
      clientId: newIntervention.clientId,
      type: selectedType,
      status: newIntervention.status,
      urgency: Number(newIntervention.urgency || 2),
      openedAt: newIntervention.openedAt || nowIso(),
      description: newIntervention.description,
      parentInterventionId: newIntervention.parentInterventionId || null,
      additionalData: {
        ...additionalData,
        createdBy: {
          code: operatorProfile.code,
          name: operatorProfile.name || 'Operatore'
        }
      },
      updatedAt: nowIso(),
      version: 1
    });

    try {
      const created = await apiFetch('/api/interventions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setInterventions((prev) => sanitizeInterventions([created, ...prev], initialInterventions));
      setNewIntervention({
        clientId: '', type: forcedType || selectedType || 'chiamata', status: 'pendente', urgency: 2, openedAt: nowIso(), description: '', parentInterventionId: '',
        applianceBrand: '', applianceModel: '', serialNumber: '', defect: '',
        sparePartCode: '', sparePartQty: 1, supplier: '', quoteItems: '', quoteTotal: 0, quoteValidUntil: ''
      });
      setInterventionCustomerQuery('');
      setNewInterventionFiles([]);
      setSyncStatus('Intervento creato nel backend.');
      setShowCalendarQuickAdd(false);
      addToast('Intervento creato con successo.', 'success');
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        setInterventions((prev) => sanitizeInterventions([payload, ...prev], initialInterventions));
        setNewIntervention({
          clientId: '', type: forcedType || selectedType || 'chiamata', status: 'pendente', urgency: 2, openedAt: nowIso(), description: '', parentInterventionId: '',
          applianceBrand: '', applianceModel: '', serialNumber: '', defect: '',
          sparePartCode: '', sparePartQty: 1, supplier: '', quoteItems: '', quoteTotal: 0, quoteValidUntil: ''
        });
        setInterventionCustomerQuery('');
        setNewInterventionFiles([]);
        setShowCalendarQuickAdd(false);
        addToast('Intervento salvato in locale (token mancante/non valido).', 'success');
        setSyncStatus('Modalità locale: intervento salvato solo nel browser.');
      } else {
        handleApiError(error, 'Impossibile creare l\'intervento.');
      }
    }
  };

  const handleInterventionStatusChange = async (intervention, status) => {
    if (!intervention || intervention.status === status) return;
    const updated = {
      ...intervention,
      status,
      updatedAt: nowIso(),
      closedAt: status === 'chiuso' ? nowIso() : intervention.closedAt
    };
    try {
      const saved = await apiFetchWithRetry(`/api/interventions/${intervention.id}`, {
        method: 'PUT',
        body: JSON.stringify(updated)
      });
      setInterventions((prev) => prev.map((entry) => (entry.id === intervention.id ? sanitizeIntervention(saved) : entry)));
      setSyncStatus('Intervento aggiornato.');
    } catch (error) {
      handleApiError(error, 'Impossibile aggiornare lo stato intervento.');
    }
  };

  const handleInterventionScheduleChange = async (intervention, openedAt) => {
    if (!intervention || !openedAt) return false;
    const updated = sanitizeIntervention({
      ...intervention,
      openedAt,
      updatedAt: nowIso()
    });
    if (!updated) return false;
    try {
      const saved = await apiFetchWithRetry(`/api/interventions/${intervention.id}`, {
        method: 'PUT',
        body: JSON.stringify(updated)
      });
      setInterventions((prev) => prev.map((entry) => (entry.id === intervention.id ? sanitizeIntervention(saved) : entry)));
      setSyncStatus('Data intervento aggiornata.');
      addToast('Data intervento aggiornata.', 'success');
      return true;
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        setInterventions((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
        setSyncStatus('Modalità locale: data intervento aggiornata solo nel browser.');
        addToast('Data intervento aggiornata in locale (token mancante/non valido).', 'success');
        return true;
      }
      handleApiError(error, 'Impossibile aggiornare la data intervento.');
      return false;
    }
  };

  const openInterventionDetails = (intervention) => {
    const safe = sanitizeIntervention(intervention);
    if (!safe) return;
    setSelectedIntervention({
      ...safe,
      descriptionEntries: getDescriptionEntries(safe),
      newNote: ''
    });
  };

  const handleSaveInterventionDetails = async () => {
    if (!selectedIntervention) return;

    const noteText = (selectedIntervention.newNote || '').trim();
    const nextEntries = [...(selectedIntervention.descriptionEntries || [])];

    if (noteText) {
      nextEntries.push({
        id: crypto?.randomUUID?.() || `${Date.now()}`,
        text: noteText,
        authorCode: operatorProfile.code,
        authorName: operatorProfile.name || 'Operatore',
        createdAt: nowIso(),
        source: 'note'
      });
    }

    const payload = sanitizeIntervention({
      ...selectedIntervention,
      description: buildDescriptionFromEntries(nextEntries),
      additionalData: {
        ...(selectedIntervention.additionalData || {}),
        descriptionEntries: nextEntries,
        lastEditor: {
          code: operatorProfile.code,
          name: operatorProfile.name || 'Operatore',
          at: nowIso()
        }
      },
      updatedAt: nowIso()
    });

    try {
      const saved = await apiFetchWithRetry(`/api/interventions/${selectedIntervention.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      const sanitized = sanitizeIntervention(saved);
      setInterventions((prev) => prev.map((entry) => (entry.id === selectedIntervention.id ? sanitized : entry)));
      setSelectedIntervention(null);
      addToast('Dettagli intervento aggiornati.', 'success');
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        setInterventions((prev) => prev.map((entry) => (entry.id === selectedIntervention.id ? payload : entry)));
        setSelectedIntervention(null);
        addToast('Intervento aggiornato in locale.', 'success');
      } else {
        handleApiError(error, 'Impossibile salvare i dettagli intervento.');
      }
    }
  };

  const handleCreatePart = async () => {
    if (!newPart.name.trim()) {
      addToast('Inserisci almeno il nome del ricambio.', 'error');
      return;
    }
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
      setNewPart({ code: '', name: '', description: '', location: '', qty: 1, price: 0, minQty: 5, priceDate: new Date().toISOString().split('T')[0] });
      setShowNewPart(false);
      setSyncStatus('Ricambio salvato nel backend.');
      addToast('Ricambio salvato.', 'success');
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        setInventory((prev) => sanitizeInventoryList([...prev, part], initialInventory));
        setNewPart({ code: '', name: '', description: '', location: '', qty: 1, price: 0, minQty: 5, priceDate: new Date().toISOString().split('T')[0] });
        setShowNewPart(false);
        addToast('Ricambio salvato in locale (token mancante/non valido).', 'success');
        setSyncStatus('Modalità locale: ricambio salvato solo nel browser.');
      } else {
        handleApiError(error, 'Impossibile salvare il ricambio.');
      }
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
    const linkedIntervention = interventions.find((entry) => entry.id === ticket.id);

    if (linkedIntervention) {
      const interventionUpdate = {
        ...linkedIntervention,
        status: mapTicketStatusToInterventionStatus(status, linkedIntervention.status),
        updatedAt: nowIso(),
        closedAt: status === 'chiuso' ? nowIso() : linkedIntervention.closedAt
      };
      try {
        const saved = await apiFetchWithRetry(`/api/interventions/${linkedIntervention.id}`, {
          method: 'PUT',
          body: JSON.stringify(interventionUpdate)
        });
        setInterventions((prev) => prev.map((entry) => (entry.id === linkedIntervention.id ? sanitizeIntervention(saved) : entry)));
        setSyncStatus('Intervento/ticket aggiornato.');
        addToast('Stato ticket aggiornato.', 'success');
      } catch (error) {
        handleApiError(error, 'Impossibile aggiornare lo stato del ticket.');
        setInterventions((prev) => prev.map((entry) => (entry.id === linkedIntervention.id ? sanitizeIntervention(interventionUpdate) : entry)));
      }
      return;
    }

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

  const handleDeleteTicketEntry = async (ticket) => {
    if (!ticket) return;
    const linkedIntervention = interventions.find((entry) => entry.id === ticket.id);
    if (linkedIntervention) {
      if (!confirm("Sei sicuro?")) return;
      try {
        await apiFetch(`/api/interventions/${ticket.id}`, { method: 'DELETE' });
        setInterventions((prev) => prev.filter((entry) => entry.id !== ticket.id));
        setSyncStatus('Ticket/intervento eliminato dal backend.');
        addToast('Ticket eliminato.', 'success');
      } catch (error) {
        handleApiError(error, 'Impossibile eliminare il ticket.');
      }
      return;
    }
    await handleDelete('tickets', ticket.id);
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
    setExportNotice(`File scaricato con successo. Cerca "${filename}" nella cartella Download.`);
  };

const buildBackup = () => ({
  exportedAt: new Date().toISOString(),
  customers,
  tickets,
  interventions,
  inventory,
  settings
});

  const persistMbiSnapshot = async (backupPayload) => {
    try {
      await Promise.all([
        idbSet('mbi_snapshot', JSON.stringify(backupPayload)),
        idbSet('mbi_snapshot_at', backupPayload.exportedAt)
      ]);
      setMbiStatus(`Snapshot MBI locale aggiornato (${new Date(backupPayload.exportedAt).toLocaleTimeString('it-IT')}).`);
    } catch {
      setMbiStatus('Snapshot MBI locale non disponibile: verifica permessi storage browser.');
    }
  };

  const handleMbiSyncNow = async () => {
    const backup = buildBackup();
    await persistMbiSnapshot(backup);
    try {
      await apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify(backup)
      });
      setMbiStatus(`MBI remoto sincronizzato alle ${new Date().toLocaleTimeString('it-IT')}.`);
      addToast('Sincronizzazione MBI completata.', 'success');
    } catch (error) {
      if (shouldFallbackToLocal(error)) {
        setMbiStatus('MBI: backend non raggiungibile, snapshot locale comunque salvato.');
        addToast('MBI locale salvato, remoto non disponibile.', 'success');
      } else {
        handleApiError(error, 'Sincronizzazione MBI non riuscita.');
      }
    }
  };

  const saveAutoBackup = () => {
    const backup = buildBackup();
    saveBackup(backup);
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

  useEffect(() => {
    if (!mbiEnabled) return;
    const backup = buildBackup();
    persistMbiSnapshot(backup);
  }, [mbiEnabled, customers, tickets, interventions, inventory, settings]);

  const handleExportTickets = () => {
    exportToCsv('tickets_export.csv',
      ['ID', 'Oggetto', 'Descrizione', 'Cliente', 'Tipologia', 'Urgenza', 'Stato', 'Data', 'Ora'],
      displayedTickets.map(t => [t.id, t.subject, t.description, customers.find(c => c.id === t.customerId)?.name || '', t.type || 'chiamata', t.urgency || 2, t.status, t.date, t.time])
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

  const handleExportInterventions = () => {
    exportToCsv('interventi_export.csv',
      ['ID', 'Cliente', 'Tipo', 'Stato', 'Urgenza', 'Apertura', 'Durata (giorni)', 'Descrizione'],
      interventions.map((i) => [
        i.id,
        customers.find((c) => c.id === i.clientId)?.name || '',
        i.type,
        i.status,
        i.urgency,
        i.openedAt,
        i.durationDays,
        i.description
      ])
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
            interventions: parsed.interventions || [],
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
          interventions: latestBackup.interventions || [],
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
          interventions,
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
    const safeSubject = (ticketSubject || '').trim() || 'Intervento senza oggetto';
    const safeDescription = (ticketDescription || '').trim() || 'Nessuna descrizione fornita.';


    setLoadingAi(true);
    setAiSuggestion(null);
    setAiError(null);


    try {
      const content = await callDeepSeekApi({ endpoint, requestHeaders, safeSubject, safeDescription });
      setAiSuggestion({ text: content, confidence: "DeepSeek AI" });
    } catch (error) {
      const offline = buildOfflineSuggestion(ticketSubject, ticketDescription);
      let message = error?.message || "Errore connessione AI.";
      if (message.toLowerCase().includes("failed to fetch")) {
        message = "Impossibile contattare il proxy DeepSeek (/api/deepseek). Verifica che il server sia avviato e che la variabile DEEPSEEK_API_KEY sia impostata lato backend.";
      }
      setAiSuggestion({ text: offline, confidence: "Offline" });
      setAiError(message);
    } finally { setLoadingAi(false); }
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
            <p className="text-3xl font-bold">{tickets.filter((t) => t.status === 'aperto').length}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-yellow-500">
            <p className="text-slate-500">Ticket in Lavorazione</p>
            <p className="text-3xl font-bold">{tickets.filter((t) => t.status === 'in lavorazione').length}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-purple-500">
            <p className="text-slate-500">Interventi Aperti</p>
            <p className="text-3xl font-bold">{openInterventions.length}</p>
          </div>
          <div className="bg-white p-6 rounded shadow border-l-4 border-red-500">
            <p className="text-slate-500">Scorte Basse</p>
            <p className="text-3xl font-bold text-red-600">{lowStock.length}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(interventionTypeMeta).map(([typeKey, meta]) => {
            const count = openInterventions.filter((item) => item.type === typeKey).length;
            return (
              <button
                key={typeKey}
                onClick={() => switchToTab(Object.entries(dedicatedTabToType).find(([, value]) => value === typeKey)?.[0] || 'interventions')}
                className="bg-white p-4 rounded shadow border border-slate-200 text-left hover:border-slate-300"
              >
                <p className="text-sm text-slate-500">{meta.label} aperte</p>
                <p className="text-2xl font-bold text-slate-800">{count}</p>
              </button>
            );
          })}
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

  const InterventionsView = () => {
    const filtered = interventions.filter((item) => {
      const customerName = customers.find((c) => c.id === item.clientId)?.name || '';
      const query = interventionSearch.trim().toLowerCase();
      const matchesSearch = !query
        || item.id.toLowerCase().includes(query)
        || item.description.toLowerCase().includes(query)
        || customerName.toLowerCase().includes(query);
      const matchesClient = !interventionFilters.clientId || item.clientId === interventionFilters.clientId;
      const matchesType = !interventionFilters.type || item.type === interventionFilters.type;
      const matchesStatus = !interventionFilters.status || item.status === interventionFilters.status;
      const matchesUrgency = !interventionFilters.urgency || Number(item.urgency) === Number(interventionFilters.urgency);
      return matchesSearch && matchesClient && matchesType && matchesStatus && matchesUrgency;
    });

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-slate-800">Interventi</h2>
            <p className="text-sm text-slate-500">Gestione chiamate, riparazioni, ordini ricambi e preventivi.</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow border border-slate-200 p-4 grid md:grid-cols-5 gap-3">
          <input className="border rounded p-2 md:col-span-2" placeholder="Ricerca globale per codice, cliente o descrizione" value={interventionSearch} onChange={(e) => setInterventionSearch(e.target.value)} />
          <select className="border rounded p-2" value={interventionFilters.clientId} onChange={(e) => setInterventionFilters((p) => ({ ...p, clientId: e.target.value }))}>
            <option value="">Tutti i clienti</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="border rounded p-2" value={interventionFilters.type} onChange={(e) => setInterventionFilters((p) => ({ ...p, type: e.target.value }))}>
            <option value="">Tutti i tipi</option>
            {interventionTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="border rounded p-2" value={interventionFilters.status} onChange={(e) => setInterventionFilters((p) => ({ ...p, status: e.target.value }))}>
            <option value="">Tutti gli stati</option>
            {interventionStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="border rounded p-2" value={interventionFilters.urgency} onChange={(e) => setInterventionFilters((p) => ({ ...p, urgency: e.target.value }))}>
            <option value="">Tutte le urgenze</option>
            <option value="1">Bassa</option>
            <option value="2">Media</option>
            <option value="3">Alta</option>
          </select>
          <button onClick={handleExportInterventions} className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-3 py-2">Esporta CSV</button>
        </div>

        <div className="bg-white rounded-xl shadow border border-slate-200 p-4 space-y-3">
          <h3 className="font-semibold text-slate-700">Nuovo intervento</h3>
          <input
            className="w-full border rounded p-2"
            placeholder="Cerca cliente per nome, email o telefono"
            value={interventionCustomerQuery}
            onChange={(e) => setInterventionCustomerQuery(e.target.value)}
          />
          <div className="grid md:grid-cols-4 gap-3">
            <select
              className="border rounded p-2"
              value={newIntervention.clientId}
              onChange={(e) => {
                if (e.target.value === '__add_new_customer__') {
                  setReturnToInterventionAfterCustomer(true);
                  setShowNewCustomer(true);
                  return;
                }
                setNewIntervention((p) => ({ ...p, clientId: e.target.value }));
              }}
            >
              <option value="">Cliente...</option>
              {filteredInterventionCustomers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `• ${c.phone}` : ''}</option>)}
              <option value="__add_new_customer__">+ Aggiungi nuovo cliente</option>
            </select>
            <select className="border rounded p-2" value={newIntervention.type} onChange={(e) => setNewIntervention((p) => ({ ...p, type: e.target.value }))}>
              {interventionTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="border rounded p-2" value={newIntervention.status} onChange={(e) => setNewIntervention((p) => ({ ...p, status: e.target.value }))}>
              {interventionStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="border rounded p-2" value={newIntervention.urgency} onChange={(e) => setNewIntervention((p) => ({ ...p, urgency: Number(e.target.value) }))}>
              <option value={1}>Bassa</option><option value={2}>Media</option><option value={3}>Alta</option>
            </select>
          </div>
          <input
            type="datetime-local"
            className="w-full border rounded p-2"
            value={toLocalDateTimeInput(newIntervention.openedAt)}
            onChange={(e) => setNewIntervention((p) => ({ ...p, openedAt: new Date(e.target.value).toISOString() }))}
          />
          <textarea className="w-full border rounded p-2" placeholder="Descrizione" value={newIntervention.description} onChange={(e) => setNewIntervention((p) => ({ ...p, description: e.target.value }))} />
          {newIntervention.type === 'riparazione' && (
            <div className="grid md:grid-cols-4 gap-3">
              <input className="border rounded p-2" placeholder="Marca" value={newIntervention.applianceBrand} onChange={(e) => setNewIntervention((p) => ({ ...p, applianceBrand: e.target.value }))} />
              <input className="border rounded p-2" placeholder="Modello" value={newIntervention.applianceModel} onChange={(e) => setNewIntervention((p) => ({ ...p, applianceModel: e.target.value }))} />
              <input className="border rounded p-2" placeholder="Seriale" value={newIntervention.serialNumber} onChange={(e) => setNewIntervention((p) => ({ ...p, serialNumber: e.target.value }))} />
              <input className="border rounded p-2" placeholder="Difetto" value={newIntervention.defect} onChange={(e) => setNewIntervention((p) => ({ ...p, defect: e.target.value }))} />
            </div>
          )}
          {newIntervention.type === 'ordine_ricambi' && (
            <div className="grid md:grid-cols-3 gap-3">
              <input className="border rounded p-2" placeholder="Codice ricambio" value={newIntervention.sparePartCode} onChange={(e) => setNewIntervention((p) => ({ ...p, sparePartCode: e.target.value }))} />
              <input type="number" className="border rounded p-2" placeholder="Quantità" value={newIntervention.sparePartQty} onChange={(e) => setNewIntervention((p) => ({ ...p, sparePartQty: Number(e.target.value) }))} />
              <input className="border rounded p-2" placeholder="Fornitore" value={newIntervention.supplier} onChange={(e) => setNewIntervention((p) => ({ ...p, supplier: e.target.value }))} />
            </div>
          )}
          {newIntervention.type === 'preventivo' && (
            <div className="grid md:grid-cols-3 gap-3">
              <input className="border rounded p-2" placeholder="Modelli/prodotti proposti" value={newIntervention.quoteItems} onChange={(e) => setNewIntervention((p) => ({ ...p, quoteItems: e.target.value }))} />
              <input type="number" className="border rounded p-2" placeholder="Importo" value={newIntervention.quoteTotal} onChange={(e) => setNewIntervention((p) => ({ ...p, quoteTotal: Number(e.target.value) }))} />
              <input type="date" className="border rounded p-2" value={newIntervention.quoteValidUntil} onChange={(e) => setNewIntervention((p) => ({ ...p, quoteValidUntil: e.target.value }))} />
            </div>
          )}
          <div className="space-y-2">
            <label className="block text-xs text-slate-500">Allegati foto/documenti</label>
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              className="w-full border rounded p-2 text-sm"
              onChange={(e) => setNewInterventionFiles(Array.from(e.target.files || []))}
            />
            {newInterventionFiles.length > 0 && (
              <p className="text-xs text-slate-500">{newInterventionFiles.length} allegato/i selezionato/i.</p>
            )}
          </div>
          <button onClick={handleAddIntervention} className="bg-indigo-600 text-white px-4 py-2 rounded">Salva intervento</button>
        </div>

        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr,1fr,1fr,1fr,1fr,1fr,0.8fr,0.8fr] gap-3 px-4 py-3 bg-slate-50 text-xs uppercase font-semibold text-slate-500">
            <div>Codice</div><div>Cliente</div><div>Tipo</div><div>Stato</div><div>Urgenza</div><div>Data apertura</div><div>Durata</div><div>Azioni</div>
          </div>
          <div className="divide-y divide-slate-100">
            {filtered.map((item) => (
              <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1.2fr,1fr,1fr,1fr,1fr,1fr,0.8fr] gap-3 px-4 py-3 items-center cursor-pointer hover:bg-slate-50" onClick={() => openInterventionDetails(item)}>
                <div className="font-mono text-xs">{item.id}</div>
                <div>{customers.find((c) => c.id === item.clientId)?.name || 'N/D'}</div>
                <div>{item.type}</div>
                <div>
                  <select className="border rounded p-1 text-sm" value={item.status} onClick={(e) => e.stopPropagation()} onChange={(e) => handleInterventionStatusChange(item, e.target.value)}>
                    {interventionStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>{item.urgency === 3 ? 'Alta' : item.urgency === 2 ? 'Media' : 'Bassa'}</div>
                <div>{new Date(item.openedAt).toLocaleString('it-IT')}</div>
                <div>{item.durationDays}</div>
                <div>
                  <button className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 bg-indigo-50" onClick={(e) => { e.stopPropagation(); openInterventionDetails(item); }}>Apri</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const DedicatedInterventionDashboard = ({ tabKey }) => {
    const typeKey = dedicatedTabToType[tabKey] || 'chiamata';
    const meta = interventionTypeMeta[typeKey];
    const typeItems = interventions.filter((item) => item.type === typeKey);
    const typeOpen = typeItems.filter((item) => item.status !== 'chiuso');

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-slate-800">Dashboard {meta.label}</h2>
            <p className="text-sm text-slate-500">Riepilogo ticket/interventi dedicato e creazione rapida.</p>
          </div>
          <button onClick={() => switchToTab('interventions')} className="bg-slate-100 border text-slate-700 px-3 py-2 rounded">Vista completa interventi</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded shadow border border-slate-200">
            <p className="text-sm text-slate-500">Aperti</p>
            <p className="text-2xl font-bold">{typeOpen.length}</p>
          </div>
          <div className="bg-white p-4 rounded shadow border border-slate-200">
            <p className="text-sm text-slate-500">Totali</p>
            <p className="text-2xl font-bold">{typeItems.length}</p>
          </div>
          <div className="bg-white p-4 rounded shadow border border-slate-200">
            <p className="text-sm text-slate-500">Urgenti</p>
            <p className="text-2xl font-bold">{typeOpen.filter((item) => Number(item.urgency) === 3).length}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow border border-slate-200 p-4 space-y-3">
          <h3 className="font-semibold text-slate-700">Nuova {meta.singularLabel?.toLowerCase() || 'attività'}</h3>
          <input
            className="w-full border rounded p-2"
            placeholder="Cerca cliente per nome, email o telefono"
            value={interventionCustomerQuery}
            onChange={(e) => setInterventionCustomerQuery(e.target.value)}
          />
          <div className="grid md:grid-cols-3 gap-3">
            <select
              className="border rounded p-2"
              value={newIntervention.clientId}
              onChange={(e) => {
                if (e.target.value === '__add_new_customer__') {
                  setReturnToInterventionAfterCustomer(true);
                  setShowNewCustomer(true);
                  return;
                }
                setNewIntervention((p) => ({ ...p, type: typeKey, clientId: e.target.value }));
              }}
            >
              <option value="">Cliente...</option>
              {filteredInterventionCustomers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `• ${c.phone}` : ''}</option>)}
              <option value="__add_new_customer__">+ Aggiungi nuovo cliente</option>
            </select>
            <select className="border rounded p-2" value={newIntervention.status} onChange={(e) => setNewIntervention((p) => ({ ...p, type: typeKey, status: e.target.value }))}>
              {interventionStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="border rounded p-2" value={newIntervention.urgency} onChange={(e) => setNewIntervention((p) => ({ ...p, type: typeKey, urgency: Number(e.target.value) }))}>
              <option value={1}>Bassa</option><option value={2}>Media</option><option value={3}>Alta</option>
            </select>
          </div>
          <input
            type="datetime-local"
            className="w-full border rounded p-2"
            value={toLocalDateTimeInput(newIntervention.openedAt)}
            onChange={(e) => setNewIntervention((p) => ({ ...p, type: typeKey, openedAt: new Date(e.target.value).toISOString() }))}
          />
          <textarea className="w-full border rounded p-2" placeholder="Descrizione" value={newIntervention.description} onChange={(e) => setNewIntervention((p) => ({ ...p, type: typeKey, description: e.target.value }))} />
          <button onClick={() => handleAddIntervention(typeKey)} className="bg-indigo-600 text-white px-4 py-2 rounded">Aggiungi {meta.singularLabel?.toLowerCase() || 'attività'}</button>
        </div>

        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-5 gap-3 px-4 py-3 bg-slate-50 text-xs uppercase font-semibold text-slate-500">
            <div>Codice</div><div>Cliente</div><div>Stato</div><div>Data</div><div>Azioni</div>
          </div>
          <div className="divide-y divide-slate-100">
            {typeItems.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">Nessun ticket presente.</div>}
            {typeItems.slice(0, 20).map((item) => (
              <div key={item.id} className="grid grid-cols-4 gap-3 px-4 py-3 items-center cursor-pointer hover:bg-slate-50" onClick={() => openInterventionDetails(item)}>
                <div className="font-mono text-xs">{item.id}</div>
                <div>{customers.find((c) => c.id === item.clientId)?.name || 'N/D'}</div>
                <div>{item.status}</div>
                <div>{new Date(item.openedAt).toLocaleString('it-IT')}</div>
                <div>
                  <button className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 bg-indigo-50" onClick={(e) => { e.stopPropagation(); openInterventionDetails(item); }}>Apri</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
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
      <div className="bg-white rounded shadow overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-semibold text-slate-700">Storico interventi cliente</div>
        <div className="divide-y">
          {customers.map((c) => {
            const customerInterventions = interventions.filter((i) => i.clientId === c.id);
            return (
              <div key={`history-${c.id}`} className="p-4">
                <p className="font-semibold text-slate-700">{c.name} <span className="text-xs text-slate-400">({customerInterventions.length})</span></p>
                <div className="text-xs text-slate-500 mt-1">
                  {customerInterventions.slice(0, 5).map((i) => `${i.id} • ${i.type} • ${i.status}`).join(' | ') || 'Nessun intervento'}
                </div>
              </div>
            );
          })}
        </div>
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
      <div className="bg-white rounded shadow p-4 border border-slate-200">
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Campo di ricerca</label>
            <select
              className="w-full border rounded p-2 text-sm"
              value={inventorySearchField}
              onChange={(e) => setInventorySearchField(e.target.value)}
            >
              <option value="all">Tutti i campi</option>
              <option value="name">Prodotto</option>
              <option value="code">Codice</option>
              <option value="description">Descrizione</option>
              <option value="location">Posizione</option>
              <option value="price">Prezzo</option>
              <option value="priceDate">Valido dal</option>
              <option value="qty">Quantità</option>
              <option value="minQty">Scorta minima</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Ricerca rapida</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm"
              placeholder="Cerca nel magazzino..."
              value={inventorySearch}
              onChange={(e) => setInventorySearch(e.target.value)}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Risultati trovati: <span className="font-semibold text-slate-700">{filteredInventory.length}</span> su {inventory.length}
        </p>
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-100 uppercase text-sm font-semibold text-slate-600">
            <tr>
                <th className="p-4">Prodotto</th>
                <th className="p-4">Codice</th>
                <th className="p-4">Posizione</th>
                <th className="p-4">Prezzo</th>
                <th className="p-4">Valido dal</th>
                <th className="p-4 text-center">Quantità</th>
                <th className="p-4 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredInventory.map(item => (
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
                <td className="p-4 text-sm text-slate-500">{item.priceDate ? new Date(item.priceDate).toLocaleDateString('it-IT') : 'N/D'}</td>
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
            {filteredInventory.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-sm text-slate-500">Nessun articolo trovato con i criteri selezionati.</td>
              </tr>
            )}
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
        <h2 className="text-lg font-bold text-slate-800 mb-2">Accreditamento operatore</h2>
        <p className="text-sm text-slate-500 mb-4">Ogni operatore ha un codice univoco usato nel tracciamento modifiche interventi.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-700">Codice operatore</label>
            <input className="w-full border rounded p-2 text-sm bg-slate-50" value={operatorProfile.code} readOnly />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700">Nome operatore</label>
            <input
              className="w-full border rounded p-2 text-sm"
              value={operatorProfile.name}
              onChange={(e) => setOperatorProfile((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
        </div>
        <button
          onClick={() => setOperatorProfile((prev) => ({ ...prev, code: generateUserCode() }))}
          className="mt-3 px-3 py-2 text-sm bg-slate-100 border rounded"
        >
          Genera nuovo codice
        </button>
      </div>

      <div className="bg-white rounded shadow p-4 border border-slate-200">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Autenticazione</h2>
        <p className="text-sm text-slate-500 mb-4">Inserisci credenziali nel formato username:password (es. admin:admin123!). I token JWT sono gestiti con cookie HttpOnly.</p>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            type="password"
            className="w-full border rounded p-2 text-sm"
            placeholder="username:password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button onClick={handleSaveToken} className="px-4 py-2 bg-slate-800 text-white rounded">Login</button>
          <button onClick={handleRequestNewToken} className="px-4 py-2 bg-slate-100 text-slate-700 rounded border">Richiedi nuovo token</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Sessione: {maskedToken || 'non autenticato'} {currentRole ? `• ruolo ${currentRole}` : ''}.</p>
        <button onClick={handleLogout} className="mt-2 px-3 py-1 text-xs bg-slate-100 border rounded">Logout</button>
      </div>
      <div className="bg-white rounded shadow p-4 border border-slate-200">
        <h2 className="text-lg font-bold text-slate-800 mb-2">Configurazione AI DeepSeek</h2>
        <p className="text-sm text-slate-500">
          La configurazione AI è gestita dal server. Assicurati che <code className="font-mono">DEEPSEEK_API_KEY</code> sia impostata.
        </p>
      </div>
    </div>
  );





  const CalendarView = () => {
    const calendarEvents = interventions.map((item) => {
      const customer = customers.find((entry) => entry.id === item.clientId);
      const typeLabel = interventionTypeMeta[item.type]?.singularLabel || 'Intervento';
      const title = `${typeLabel} • ${customer?.name || 'Cliente non assegnato'}`;
      const statusColors = {
        pendente: '#2563eb',
        in_corso: '#d97706',
        completato: '#16a34a',
        chiuso: '#64748b'
      };
      const eventColor = statusColors[item.status] || '#334155';
      return {
        id: item.id,
        title,
        start: item.openedAt,
        allDay: false,
        backgroundColor: eventColor,
        borderColor: eventColor,
        textColor: '#ffffff',
        extendedProps: {
          interventionId: item.id,
          type: item.type,
          status: item.status,
          urgency: item.urgency,
          customerName: customer?.name || 'Cliente non assegnato'
        }
      };
    });

    useEffect(() => {
      if (!calendarRef.current || !window.FullCalendar?.Calendar) return;
      const calendar = new window.FullCalendar.Calendar(calendarRef.current, {
        locale: 'it',
        initialView: 'dayGridMonth',
        headerToolbar: {
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        buttonText: {
          today: 'Oggi',
          month: 'Mese',
          week: 'Settimana',
          day: 'Giorno'
        },
        editable: true,
        selectable: true,
        dayMaxEvents: true,
        events: calendarEvents,
        eventDrop: async (info) => {
          const intervention = interventions.find((entry) => entry.id === info.event.id);
          if (!intervention) {
            info.revert();
            return;
          }
          const saved = await handleInterventionScheduleChange(intervention, info.event.start?.toISOString());
          if (!saved) info.revert();
        },
        eventClick: (info) => {
          const intervention = interventions.find((entry) => entry.id === info.event.id);
          if (!intervention) return;
          openInterventionDetails(intervention);
        },
        select: (selectionInfo) => {
          openInterventionComposer(selectionInfo.start.toISOString(), 'chiamata', { keepCalendarOpen: true });
        },
        height: 'auto'
      });
      calendar.render();
      calendarApiRef.current = calendar;

      return () => {
        calendarApiRef.current = null;
        calendar.destroy();
      };
    }, [calendarEvents, interventions]);

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center bg-white p-4 rounded shadow">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Calendario interventi</h2>
            <p className="text-sm text-slate-500">Vista mese, settimana e giorno con drag & drop stile Google Calendar.</p>
          </div>
          <button
            onClick={() => {
              const currentDate = calendarApiRef.current?.getDate() || new Date();
              openInterventionComposer(currentDate.toISOString(), 'chiamata', { keepCalendarOpen: true });
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded flex gap-2 items-center"
          >
            <Plus /> Nuovo intervento
          </button>
        </div>

        <div className="bg-white rounded shadow p-4">
          <div ref={calendarRef} />
        </div>

        {showCalendarQuickAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white w-full max-w-xl rounded-xl shadow-2xl p-6">
              <h3 className="text-xl font-bold mb-1">Nuova chiamata</h3>
              <p className="text-sm text-slate-500 mb-4">{new Date(newIntervention.openedAt || nowIso()).toLocaleString('it-IT')}</p>
              <div className="space-y-3">
                <select
                  className="w-full border rounded p-2"
                  value={newIntervention.clientId}
                  onChange={(e) => setNewIntervention((prev) => ({ ...prev, type: 'chiamata', clientId: e.target.value }))}
                >
                  <option value="">Cliente...</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `• ${c.phone}` : ''}</option>)}
                </select>
                <input
                  type="datetime-local"
                  className="w-full border rounded p-2"
                  value={toLocalDateTimeInput(newIntervention.openedAt)}
                  onChange={(e) => setNewIntervention((prev) => ({ ...prev, type: 'chiamata', openedAt: new Date(e.target.value).toISOString() }))}
                />
                <textarea
                  className="w-full border rounded p-2"
                  rows={4}
                  placeholder="Descrizione chiamata"
                  value={newIntervention.description}
                  onChange={(e) => setNewIntervention((prev) => ({ ...prev, type: 'chiamata', description: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowCalendarQuickAdd(false)} className="px-4 py-2 text-slate-500">Chiudi</button>
                <button onClick={() => handleAddIntervention('chiamata')} className="px-4 py-2 bg-indigo-600 text-white rounded">Aggiungi chiamata</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const validInventoryImportCount = inventoryImportPreview.filter((entry) => entry.errors.length === 0).length;
  const hasInventoryImportErrors = Boolean(inventoryImportHeaderError) || inventoryImportPreview.some((entry) => entry.errors.length > 0);

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900 overflow-hidden">
      <Sidebar
        isSidebarOpen={isSidebarOpen}
        activeTab={activeTab}
        onClose={() => setIsSidebarOpen(false)}
        onSwitchTab={switchToTab}
        onResetData={handleResetData}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm z-30 p-4 flex justify-between items-center md:hidden">
           <span className="font-bold text-slate-700 flex items-center gap-2"><Zap className="text-yellow-500 w-5 h-5"/> FIXLAB</span>
           <button onClick={() => setIsSidebarOpen(!isSidebarOpen)}><Menu className="w-6 h-6 text-slate-600" /></button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto pb-20">
            <ActiveTabContent
              activeTab={activeTab}
              DashboardView={DashboardView}
              CalendarView={CalendarView}
              CustomerListView={CustomerListView}
              InterventionsView={InterventionsView}
              InventoryView={InventoryView}
              SettingsPanel={SettingsPanel}
              DedicatedInterventionDashboard={DedicatedInterventionDashboard}
              ticketsContent={(
                <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-bold text-slate-800">Gestione Ticket</h2>
                    <p className="text-sm text-slate-500">Visualizza i problemi segnalati, aggiorna lo stato e avvia la diagnosi AI.</p>
                  </div>
                  <button onClick={() => { setTicketCustomerQuery(''); setShowNewTicket(true); }} className="bg-blue-600 text-white px-4 py-2 rounded flex gap-2 items-center shadow">
                    <Plus/> Nuovo Ticket
                  </button>
                </div>
                <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
                  <div className="grid grid-cols-1 md:grid-cols-[2fr,1fr,1fr,1fr] gap-4 px-6 py-4 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                    <div>Elettrodomestico / Problema</div>
                    <div>Cliente</div>
                    <div>Stato</div>
                    <div className="text-right">Diagnosi AI</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {displayedTickets.map((ticket) => {
                      const customer = customers.find((c) => c.id === ticket.customerId);
                      const isActive = currentTicketForAi?.id === ticket.id;
                      return (
                        <div key={ticket.id} className={isActive ? 'bg-indigo-50/60' : 'bg-white'}>
                          <div
                            className="grid grid-cols-1 md:grid-cols-[2fr,1fr,1fr,1fr] gap-4 px-6 py-5 items-center cursor-pointer hover:bg-slate-50"
                            onClick={() => openTicketModal(ticket)}
                          >
                            <div className="flex items-start gap-3">
                              <Zap size={16} className="text-yellow-500 mt-1" />
                              <div>
                                <div className="font-semibold text-slate-800">{ticket.subject}</div>
                                <div className="text-sm text-slate-500">{ticket.description}</div>
                                <div className="text-xs text-slate-400 mt-1">
                                  {interventionTypeMeta[ticket.type]?.label || 'Chiamate'} • Urgenza {ticket.urgency === 3 ? 'Alta' : ticket.urgency === 2 ? 'Media' : 'Bassa'}
                                </div>
                              </div>
                            </div>
                            <div className="text-slate-600">{customer?.name || 'Cliente non assegnato'}</div>
                            <div>
                              <select
                                value={ticket.status}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  handleTicketStatusChange(ticket, event.target.value);
                                }}
                                className={`text-sm rounded border px-3 py-1 ${getStatusStyles(ticket.status)}`}
                              >
                                <option value="aperto">Aperto</option>
                                <option value="in lavorazione">In lavorazione</option>
                                <option value="chiuso">Chiuso</option>
                              </select>
                            </div>
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openTicketModal(ticket);
                                }}
                                className="text-indigo-600 flex items-center gap-2 hover:text-indigo-800"
                              >
                                <Bot size={16}/> Diagnosi
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteTicketEntry(ticket);
                                }}
                                className="text-red-400 hover:text-red-600"
                              >
                                <Trash2 size={18}/>
                              </button>
                            </div>
                          </div>
                          {isActive && (
                            <div className="border-t border-indigo-100 px-6 py-4 bg-indigo-50/60">
                              <div className="flex items-center gap-2 text-indigo-800 font-semibold mb-3">
                                <Bot size={18}/> DeepSeek AI - Diagnosi Preliminare
                              </div>
                              <div className="bg-white border border-indigo-100 rounded px-4 py-3 text-sm text-slate-600">
                                <span className="font-semibold text-slate-700">Problema segnalato:</span> {ticket.subject}
                              </div>
                              {aiError && (
                                <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded flex items-center gap-2">
                                  <AlertTriangle size={16}/> {aiError}
                                </div>
                              )}
                              {!aiEnabled && (
                                <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">
                                  AI non configurata: verifica che il proxy backend sia attivo e che DEEPSEEK_API_KEY sia configurata lato server.
                                </div>
                              )}
                              <div className="mt-4">
                                {aiSuggestion ? (
                                  <div className="text-sm whitespace-pre-line text-slate-700">{aiSuggestion.text}</div>
                                ) : loadingAi ? (
                                  <div className="flex items-center gap-2 text-indigo-600"><RefreshCw className="animate-spin"/> Analisi in corso...</div>
                                ) : (
                                  <button
                                    onClick={() => getDeepSeekAnalysis(ticket.description, ticket.subject)}
                                    className="bg-indigo-600 text-white px-4 py-2 rounded text-sm disabled:bg-indigo-300"
                                    disabled={!aiEnabled}
                                  >
                                    Avvia Analisi DeepSeek
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              )}
            />
          </div>
        </main>
      </div>

      <ToastList toasts={toasts} />

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


      {selectedIntervention && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedIntervention(null)}>
          <div className="bg-white p-6 rounded-lg w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-4">Dettaglio intervento</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <input className="w-full border p-2 rounded bg-slate-50" value={selectedIntervention.id} readOnly />
              <input type="datetime-local" className="w-full border p-2 rounded" value={toLocalDateTimeInput(selectedIntervention.openedAt)} onChange={(e) => setSelectedIntervention((prev) => ({ ...prev, openedAt: new Date(e.target.value).toISOString() }))} />
              <select className="w-full border p-2 rounded" value={selectedIntervention.status} onChange={(e) => setSelectedIntervention((prev) => ({ ...prev, status: e.target.value }))}>
                {interventionStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="w-full border p-2 rounded" value={selectedIntervention.urgency} onChange={(e) => setSelectedIntervention((prev) => ({ ...prev, urgency: Number(e.target.value) }))}>
                <option value={1}>Bassa</option><option value={2}>Media</option><option value={3}>Alta</option>
              </select>
            </div>
            <div className="mt-3 space-y-2">
              <p className="text-sm font-semibold text-slate-700">Storico scritte</p>
              <div className="max-h-52 overflow-y-auto border rounded p-2 bg-slate-50 space-y-2">
                {(selectedIntervention.descriptionEntries || []).length === 0 && (
                  <p className="text-xs text-slate-500">Nessuna nota disponibile.</p>
                )}
                {(selectedIntervention.descriptionEntries || []).map((entry) => (
                  <p
                    key={entry.id}
                    title={`Modificato da ${entry.authorName || 'Operatore'} (${entry.authorCode || 'N/D'}) il ${formatAuditDate(entry.createdAt)}`}
                    className={`text-sm rounded px-2 py-1 ${entry.source === 'original' ? 'bg-slate-200 text-slate-700' : 'bg-indigo-100 text-indigo-800'}`}
                  >
                    {entry.text}
                  </p>
                ))}
              </div>
              <textarea
                className="w-full border p-2 rounded"
                rows={4}
                placeholder="Aggiungi una nuova nota/intervento..."
                value={selectedIntervention.newNote || ''}
                onChange={(e) => setSelectedIntervention((prev) => ({ ...prev, newNote: e.target.value }))}
              />
              <p className="text-xs text-slate-500">Le nuove note sono colorate e mostrano autore/data passando con il mouse.</p>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setSelectedIntervention(null)} className="px-4 py-2 text-slate-500">Chiudi</button>
              <button onClick={handleSaveInterventionDetails} className="px-4 py-2 bg-indigo-600 text-white rounded">Salva modifiche</button>
            </div>
          </div>
        </div>
      )}

      {showNewTicket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
                <h3 className="text-xl font-bold mb-4">Nuovo Ticket</h3>
                <div className="space-y-3">
                    <input
                      className="w-full border p-2 rounded"
                      placeholder="Cerca cliente per nome, email o telefono"
                      value={ticketCustomerQuery}
                      onChange={(e) => setTicketCustomerQuery(e.target.value)}
                    />
                    <select
                      className="w-full border p-2 rounded"
                      value={newTicket.customerId}
                      onChange={e => {
                        if (e.target.value === '__add_new_customer__') {
                          setReturnToTicketAfterCustomer(true);
                          setShowNewTicket(false);
                          setShowNewCustomer(true);
                          return;
                        }
                        setNewTicket({...newTicket, customerId: e.target.value});
                      }}
                    >
                        <option value="">Seleziona Cliente...</option>
                        {filteredTicketCustomers.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `• ${c.phone}` : ''}</option>)}
                        <option value="__add_new_customer__">+ Aggiungi nuovo cliente</option>
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <select className="w-full border p-2 rounded" value={newTicket.type} onChange={e => setNewTicket({...newTicket, type: e.target.value})}>
                        <option value="chiamata">Chiamata</option>
                        <option value="riparazione">Riparazione</option>
                        <option value="ordine_ricambi">Ordine Ricambi</option>
                        <option value="preventivo">Preventivo</option>
                      </select>
                      <select className="w-full border p-2 rounded" value={newTicket.urgency} onChange={e => setNewTicket({...newTicket, urgency: Number(e.target.value)})}>
                        <option value={1}>Urgenza bassa</option>
                        <option value={2}>Urgenza media</option>
                        <option value={3}>Urgenza alta</option>
                      </select>
                    </div>
                    <input className="w-full border p-2 rounded" placeholder="Elettrodomestico / Problema" value={newTicket.subject} onChange={e => setNewTicket({...newTicket, subject: e.target.value})} />
                    <div className="flex gap-2">
                        <input type="date" className="w-full border p-2 rounded" value={newTicket.date} onChange={e => setNewTicket({...newTicket, date: e.target.value})} />
                        <input type="time" className="w-full border p-2 rounded" value={newTicket.time} onChange={e => setNewTicket({...newTicket, time: e.target.value})} />
                    </div>
                    <textarea className="w-full border p-2 rounded" placeholder="Descrizione dettagliata (per AI)" value={newTicket.description} onChange={e => setNewTicket({...newTicket, description: e.target.value})} />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => { setShowNewTicket(false); setReturnToTicketAfterCustomer(false); setTicketCustomerQuery(''); }} className="px-4 py-2 text-slate-500">Annulla</button>
                  <button onClick={handleCreateTicket} className="px-4 py-2 bg-blue-600 text-white rounded flex items-center gap-2" disabled={isSavingTicket}>
                    {isSavingTicket && <RefreshCw size={16} className="animate-spin"/>} Salva
                  </button>
                </div>
            </div>
        </div>
      )}

      {showNewCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => {
          setShowNewCustomer(false);
          if (returnToTicketAfterCustomer) {
            setShowNewTicket(true);
            setReturnToTicketAfterCustomer(false);
          }
          if (returnToInterventionAfterCustomer) {
            setReturnToInterventionAfterCustomer(false);
          }
        }}>
            <div className="bg-white p-6 rounded-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-xl font-bold mb-4">Nuovo Cliente</h3>
                <div className="space-y-3">
                    <input className="w-full border p-2 rounded" placeholder="Nome Completo" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Telefono" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Email" value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Indirizzo" value={newCustomer.address} onChange={e => setNewCustomer({...newCustomer, address: e.target.value})} />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => {
                    setShowNewCustomer(false);
                    if (returnToTicketAfterCustomer) {
                      setShowNewTicket(true);
                      setReturnToTicketAfterCustomer(false);
                    }
                    if (returnToInterventionAfterCustomer) {
                      setReturnToInterventionAfterCustomer(false);
                    }
                  }} className="px-4 py-2 text-slate-500">Annulla</button>
                  <button onClick={handleCreateCustomer} className="px-4 py-2 bg-green-600 text-white rounded flex items-center gap-2" disabled={isSavingCustomer}>
                    {isSavingCustomer && <RefreshCw size={16} className="animate-spin"/>} Salva
                  </button>
                </div>
            </div>
        </div>
      )}

      {showNewPart && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewPart(false)}>
            <div className="bg-white p-6 rounded-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-xl font-bold mb-4">Nuovo Articolo Magazzino</h3>
                <div className="space-y-3">
                    <input className="w-full border p-2 rounded" placeholder="Codice Articolo (es. RIC-001)" value={newPart.code} onChange={e => setNewPart({...newPart, code: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Nome Prodotto (es. Cuscinetti)" value={newPart.name} onChange={e => setNewPart({...newPart, name: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Descrizione (opzionale)" value={newPart.description} onChange={e => setNewPart({...newPart, description: e.target.value})} />
                    <input className="w-full border p-2 rounded" placeholder="Codice Posizione (es. af00021)" value={newPart.location} onChange={e => setNewPart({...newPart, location: e.target.value})} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="text-xs text-slate-500">Quantità
                          <input type="number" className="w-full border p-2 rounded mt-1" placeholder="Quantità" value={newPart.qty} onChange={e => setNewPart({...newPart, qty: parseInt(e.target.value)})} />
                        </label>
                        <label className="text-xs text-slate-500">Prezzo (€)
                          <input type="number" step="0.01" className="w-full border p-2 rounded mt-1" placeholder="Prezzo (€)" value={newPart.price} onChange={e => setNewPart({...newPart, price: parseFloat(e.target.value)})} />
                        </label>
                    </div>
                    <label className="text-xs text-slate-500">Valuta prezzo (data decorrenza)
                      <input type="date" className="w-full border p-2 rounded mt-1" value={newPart.priceDate || ''} onChange={e => setNewPart({...newPart, priceDate: e.target.value})} />
                    </label>
                    <input type="number" className="w-full border p-2 rounded" placeholder="Quantità Minima (Allarme)" value={newPart.minQty} onChange={e => setNewPart({...newPart, minQty: parseInt(e.target.value)})} />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowNewPart(false)} className="px-4 py-2 text-slate-500">Annulla</button>
                  <button onClick={handleCreatePart} className="px-4 py-2 bg-purple-600 text-white rounded flex items-center gap-2" disabled={isSavingPart}>
                    {isSavingPart && <RefreshCw size={16} className="animate-spin"/>} Salva
                  </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
