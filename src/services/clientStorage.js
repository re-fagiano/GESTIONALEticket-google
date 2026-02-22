const isBrowser = typeof window !== 'undefined';
const storageAvailable = isBrowser && typeof window.localStorage !== 'undefined';

const IDB_DB_NAME = 'gestionale_storage';
const IDB_STORE = 'keyval';
const STORAGE_VERSION = 2;
const SCHEMA_VERSION = 2;
const DATA_VERSION = 1;
const BACKUP_HISTORY_LIMIT = 5;
const CHANNEL_NAME = 'gestionale_storage_channel';

const fallbackState = {
  active: false,
  lastError: null
};

const emittedWarnings = new Set();

const cacheKeys = {
  customers: 'cache_customers',
  tickets: 'cache_tickets',
  interventions: 'cache_interventions',
  sparePartsOrders: 'cache_spare_parts_orders',
  quotes: 'cache_quotes',
  inventory: 'cache_inventory',
  settings: 'cache_settings'
};

const backupFieldByCache = {
  [cacheKeys.customers]: 'customers',
  [cacheKeys.tickets]: 'tickets',
  [cacheKeys.interventions]: 'interventions',
  [cacheKeys.sparePartsOrders]: 'sparePartsOrders',
  [cacheKeys.quotes]: 'quotes',
  [cacheKeys.inventory]: 'inventory',
  [cacheKeys.settings]: 'settings',
};

let broadcastChannel = null;


const getBroadcastChannel = () => {
  if (!isBrowser || typeof window.BroadcastChannel === 'undefined') return null;
  if (!broadcastChannel) {
    broadcastChannel = new window.BroadcastChannel(CHANNEL_NAME);
  }
  return broadcastChannel;
};

const notifyStorageUpdate = (key) => {
  const channel = getBroadcastChannel();
  if (!channel) return;
  try {
    channel.postMessage({ type: 'storage_updated', key, at: Date.now() });
  } catch (error) {
    issueStorage(`broadcast_${key}`, 'Notifica multi-tab non disponibile', error);
  }
};

const issueStorage = (code, message, error) => {
  fallbackState.active = true;
  fallbackState.lastError = error || new Error(message);
  if (!emittedWarnings.has(code)) {
    emittedWarnings.add(code);
    console.warn(message, error);
  }
};

const openIdb = () => {
  if (!isBrowser || !window.indexedDB) return Promise.reject(new Error('IDB non disponibile'));
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

const idbDelete = async (key) => {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const request = store.delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
};

const parseJsonSafe = (raw, fallback = null, errorCode = 'parse_error', errorMessage = 'Dato storage non valido') => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    issueStorage(errorCode, errorMessage, error);
    return fallback;
  }
};

const parseVersionedPayload = (raw, fallback, key = 'unknown') => {
  if (!raw) return fallback;
  const parsed = parseJsonSafe(raw, fallback, `parse_${key}`, `Errore parsing storage locale per ${key}, uso fallback`);
  if (!parsed || parsed === fallback) return fallback;

  if (
    parsed
    && typeof parsed === 'object'
    && Object.prototype.hasOwnProperty.call(parsed, 'data')
  ) {
    const schemaVersion = Number(parsed.schemaVersion ?? parsed.storageVersion ?? 1);
    if (!Number.isFinite(schemaVersion) || schemaVersion <= 0) {
      issueStorage(`schema_${key}`, `Schema storage non valido per ${key}, uso fallback`);
      return fallback;
    }
    return parsed.data;
  }

  return parsed;
};

const wrapVersionedPayload = (data) => JSON.stringify({
  storageVersion: STORAGE_VERSION,
  schemaVersion: SCHEMA_VERSION,
  dataVersion: DATA_VERSION,
  savedAt: new Date().toISOString(),
  data
});

const readRawSync = (key, fallback = null) => {
  if (!storageAvailable) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    issueStorage(`read_local_${key}`, 'Storage non accessibile, uso fallback', error);
    return fallback;
  }
};

const readRawFromIdb = async (key, fallback = null) => {
  try {
    const value = await idbGet(key);
    return value === null || typeof value === 'undefined' ? fallback : value;
  } catch (error) {
    issueStorage(`read_idb_${key}`, 'Lettura da IndexedDB fallita', error);
    return fallback;
  }
};

const writeRaw = (key, value) => {
  let written = false;
  if (!storageAvailable) {
    issueStorage(`write_local_${key}_na`, 'localStorage non disponibile, uso IndexedDB');
  } else {
    try {
      window.localStorage.setItem(key, value);
      written = true;
    } catch (error) {
      issueStorage(`write_local_${key}`, 'Impossibile scrivere su localStorage, fallback su IndexedDB', error);
    }
  }

  idbSet(key, value).catch((error) => issueStorage(`write_idb_${key}`, 'Scrittura su IndexedDB fallita', error));
  notifyStorageUpdate(key);
  return written;
};

const writeVersioned = (key, value) => writeRaw(key, wrapVersionedPayload(value));

const restoreCacheFromBackupSync = (rawKey, fallback) => {
  const backup = loadBackupSync();
  const backupField = backupFieldByCache[rawKey];
  if (!backup || !backupField) return fallback;
  const restored = backup?.[backupField];
  if (typeof restored === 'undefined') return fallback;
  writeVersioned(rawKey, restored);
  return restored;
};

const readJsonSync = (key, fallback) => {
  const raw = readRawSync(key, null);
  const parsed = parseVersionedPayload(raw, fallback, key);
  if (parsed === fallback && raw) {
    return restoreCacheFromBackupSync(key, fallback);
  }
  return parsed;
};
const readJsonFromIdb = async (key, fallback) => parseVersionedPayload(await readRawFromIdb(key, null), fallback, key);

const saveCache = (key, value) => writeVersioned(cacheKeys[key], value);
const loadCache = (key, fallback) => readJsonSync(cacheKeys[key], fallback);
const loadCacheFromIdb = (key, fallback) => readJsonFromIdb(cacheKeys[key], fallback);

const parseBackupPayload = (raw, source) => {
  const parsed = parseJsonSafe(raw, null, `backup_parse_${source}`, `Backup ${source} corrotto`);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.exportedAt || Number.isNaN(new Date(parsed.exportedAt).getTime())) return null;
  return parsed;
};

const getBackupHistorySync = () => {
  const history = readJsonSync('backup_history_v2', []);
  return Array.isArray(history) ? history : [];
};

const getBackupHistoryFromIdb = async () => {
  const history = await readJsonFromIdb('backup_history_v2', []);
  return Array.isArray(history) ? history : [];
};

const saveBackup = (backupPayload) => {
  const exportedAt = backupPayload?.exportedAt || new Date().toISOString();
  const versionedBackup = {
    ...backupPayload,
    exportedAt,
    storageVersion: STORAGE_VERSION,
    schemaVersion: SCHEMA_VERSION
  };
  const raw = JSON.stringify(versionedBackup);
  const saved = writeRaw('lastBackup', raw);
  writeRaw('lastBackupAt', exportedAt);

  const history = getBackupHistorySync();
  const nextHistory = [versionedBackup, ...history].slice(0, BACKUP_HISTORY_LIMIT);
  writeVersioned('backup_history_v2', nextHistory);
  return saved;
};

const pickLatestValidBackup = (candidates = []) => {
  const valid = candidates.filter(Boolean).sort((a, b) => (
    new Date(b.exportedAt || 0).getTime() - new Date(a.exportedAt || 0).getTime()
  ));
  return valid[0] || null;
};

const loadBackupSync = () => {
  const localLast = parseBackupPayload(readRawSync('lastBackup', null), 'locale');
  const history = getBackupHistorySync().map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    return entry;
  });
  return pickLatestValidBackup([localLast, ...history]);
};

const loadBackupFromIdb = async () => {
  const [lastRaw, history] = await Promise.all([
    readRawFromIdb('lastBackup', null),
    getBackupHistoryFromIdb()
  ]);
  const idbLast = parseBackupPayload(lastRaw, 'indexeddb');
  return pickLatestValidBackup([idbLast, ...history]);
};

const loadBackupAtSync = () => readRawSync('lastBackupAt', null);
const loadBackupAtFromIdb = () => readRawFromIdb('lastBackupAt', null);

const loadLatestValidBackup = async () => {
  const [syncBackup, idbBackup] = await Promise.all([
    Promise.resolve(loadBackupSync()),
    loadBackupFromIdb()
  ]);
  return pickLatestValidBackup([syncBackup, idbBackup]);
};

const saveMbiSnapshot = async (backupPayload) => {
  const raw = JSON.stringify(backupPayload);
  try {
    await Promise.all([
      idbSet('mbi_snapshot', raw),
      idbSet('mbi_snapshot_at', backupPayload.exportedAt),
    ]);
    writeRaw('mbi_snapshot', raw);
    writeRaw('mbi_snapshot_at', backupPayload.exportedAt);
    return true;
  } catch (error) {
    issueStorage('write_mbi_snapshot', 'Snapshot MBI locale non disponibile', error);
    return false;
  }
};

const clearAllClientData = async () => {
  const keys = [
    ...Object.values(cacheKeys),
    'operatorCode',
    'operatorName',
    'lastBackup',
    'lastBackupAt',
    'backup_history_v2',
    'mbi_snapshot',
    'mbi_snapshot_at'
  ];

  if (storageAvailable) {
    keys.forEach((key) => {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        issueStorage(`clear_local_${key}`, 'Impossibile rimuovere una chiave da localStorage', error);
      }
    });
  }

  await Promise.all(keys.map((key) => idbDelete(key).catch((error) => {
    issueStorage(`clear_idb_${key}`, 'Impossibile rimuovere una chiave da IndexedDB', error);
  })));
};

const getStorageState = () => ({
  localStorageAvailable: storageAvailable,
  fallbackActive: fallbackState.active,
  lastError: fallbackState.lastError
});

const getOperatorProfileSync = () => ({
  code: readRawSync('operatorCode', ''),
  name: readRawSync('operatorName', '')
});

const saveOperatorProfile = (profile = {}) => {
  writeRaw('operatorCode', profile.code || '');
  writeRaw('operatorName', profile.name || '');
};

const getLastSyncAtSync = () => readRawSync('sync_last_at', null);
const setLastSyncAt = (value) => writeRaw('sync_last_at', value || '');

const subscribeStorageUpdates = (listener) => {
  if (!isBrowser || typeof listener !== 'function') return () => {};

  const onStorage = (event) => {
    if (!event?.key) return;
    listener(event.key);
  };
  window.addEventListener('storage', onStorage);

  const channel = getBroadcastChannel();
  const onMessage = (event) => {
    const key = event?.data?.key;
    if (!key) return;
    listener(key);
  };
  if (channel) channel.addEventListener('message', onMessage);

  return () => {
    window.removeEventListener('storage', onStorage);
    if (channel) channel.removeEventListener('message', onMessage);
  };
};


export {
  cacheKeys,
  clearAllClientData,
  getLastSyncAtSync,
  getOperatorProfileSync,
  getStorageState,
  idbGet,
  idbSet,
  loadBackupAtFromIdb,
  loadBackupAtSync,
  loadBackupFromIdb,
  loadBackupSync,
  loadCache,
  loadCacheFromIdb,
  loadLatestValidBackup,
  readRawSync,
  saveBackup,
  saveCache,
  saveOperatorProfile,
  saveMbiSnapshot,
  setLastSyncAt,
  subscribeStorageUpdates,
  writeRaw
};
