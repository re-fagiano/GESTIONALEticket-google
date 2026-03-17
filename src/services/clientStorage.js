const memoryStore = new Map();
const listeners = new Set();

const DB_NAME = 'gestionale-ticket-db-v3';
const DB_STORE = 'kv';
const DB_VERSION = 1;
const BACKUP_HISTORY_KEY = 'backup_history';
const MAX_BACKUP_HISTORY_DAYS = 30;

let storageState = {
  localStorageAvailable: false,
  fallbackActive: false,
  lastError: null,
};

const assertFunction = (fn) => {
  if (typeof fn !== 'function') {
    throw new Error('INVALID_PERSISTED_STATE_FN');
  }
};

const cacheKeys = {
  customers: 'cache_customers',
  tickets: 'cache_tickets',
  interventions: 'cache_interventions',
  inventory: 'cache_inventory',
  settings: 'cache_settings'
};

const notify = (key) => {
  listeners.forEach((listener) => {
    assertFunction(listener);
    listener(key);
  });
};

const canUseWindow = () => typeof window !== 'undefined';

const canUseLocalStorage = () => {
  if (!canUseWindow() || !window.localStorage) return false;
  try {
    const testKey = '__storage_probe__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch (error) {
    storageState.lastError = error?.message || 'local_storage_unavailable';
    return false;
  }
};

storageState.localStorageAvailable = canUseLocalStorage();
storageState.fallbackActive = !storageState.localStorageAvailable;

const safeParse = (raw, fallback = null) => {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const readRawSync = (key, fallback = null) => {
  if (memoryStore.has(key)) return memoryStore.get(key);
  if (!storageState.localStorageAvailable) return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = safeParse(raw, fallback);
    memoryStore.set(key, parsed);
    return parsed;
  } catch (error) {
    storageState.lastError = error?.message || 'local_storage_read_error';
    storageState.fallbackActive = true;
    return fallback;
  }
};

const writeRaw = (key, value, shouldNotify = false) => {
  memoryStore.set(key, value);

  if (storageState.localStorageAvailable) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      storageState.lastError = error?.message || 'local_storage_write_error';
      storageState.fallbackActive = true;
    }
  }

  if (shouldNotify) notify(key);
  return true;
};

let dbPromise = null;

const openDb = async () => {
  if (!canUseWindow() || !window.indexedDB) return null;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_open_error'));
    }).catch((error) => {
      storageState.lastError = error?.message || 'indexeddb_unavailable';
      return null;
    });
  }
  return dbPromise;
};

const idbGet = async (key) => {
  const db = await openDb();
  if (!db) return readRawSync(key, null);

  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.get(key);
    req.onsuccess = () => {
      if (req.result !== undefined) {
        memoryStore.set(key, req.result);
        resolve(req.result);
      } else {
        resolve(readRawSync(key, null));
      }
    };
    req.onerror = () => resolve(readRawSync(key, null));
  });
};

const idbSet = async (key, value) => {
  const db = await openDb();
  writeRaw(key, value);
  if (!db) return false;

  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => {
      storageState.lastError = tx.error?.message || 'indexeddb_write_error';
      resolve(false);
    };
  });
};

const saveCache = (key, value) => {
  const storageKey = cacheKeys[key];
  if (!storageKey) return false;
  writeRaw(storageKey, value);
  idbSet(storageKey, value);
  return true;
};

const loadCache = (key, fallback) => readRawSync(cacheKeys[key], fallback);

const loadCacheFromIdb = async (key, fallback) => {
  const storageKey = cacheKeys[key];
  if (!storageKey) return fallback;
  const value = await idbGet(storageKey);
  return value ?? fallback;
};

const trimBackupHistory = (history = []) => {
  const sorted = [...history].sort((a, b) => (a.exportedAt || '').localeCompare(b.exportedAt || '')).reverse();
  const byDay = [];
  const seenDays = new Set();
  sorted.forEach((entry) => {
    const day = (entry?.exportedAt || '').slice(0, 10);
    if (!day || seenDays.has(day)) return;
    seenDays.add(day);
    byDay.push(entry);
  });
  return byDay.slice(0, MAX_BACKUP_HISTORY_DAYS);
};

const saveBackup = (backupPayload) => {
  const payload = backupPayload || null;
  writeRaw('lastBackup', payload);
  writeRaw('lastBackupAt', payload?.exportedAt || null);
  idbSet('lastBackup', payload);
  idbSet('lastBackupAt', payload?.exportedAt || null);

  if (payload?.exportedAt) {
    const existing = readRawSync(BACKUP_HISTORY_KEY, []);
    const history = trimBackupHistory([payload, ...(Array.isArray(existing) ? existing : [])]);
    writeRaw(BACKUP_HISTORY_KEY, history);
    idbSet(BACKUP_HISTORY_KEY, history);
  }

  return true;
};

const loadBackupSync = () => readRawSync('lastBackup', null);
const loadBackupFromIdb = async () => {
  const value = await idbGet('lastBackup');
  return value ?? loadBackupSync();
};
const loadBackupAtSync = () => readRawSync('lastBackupAt', null);
const loadBackupAtFromIdb = async () => {
  const value = await idbGet('lastBackupAt');
  return value ?? loadBackupAtSync();
};

const loadLatestValidBackup = async () => {
  const direct = await loadBackupFromIdb();
  if (direct?.exportedAt) return direct;

  const history = await idbGet(BACKUP_HISTORY_KEY);
  const normalized = Array.isArray(history) ? history : [];
  const latest = normalized.find((entry) => entry?.exportedAt && entry?.customers && entry?.tickets && entry?.inventory);
  return latest || null;
};

const getStorageState = () => ({ ...storageState });

const getOperatorProfileSync = () => ({
  code: readRawSync('operatorCode', ''),
  name: readRawSync('operatorName', '')
});

const saveOperatorProfile = (profile = {}) => {
  writeRaw('operatorCode', profile.code || '');
  writeRaw('operatorName', profile.name || '');
  idbSet('operatorCode', profile.code || '');
  idbSet('operatorName', profile.name || '');
};

const getLastSyncAtSync = () => readRawSync('sync_last_at', null);
const setLastSyncAt = (value) => {
  writeRaw('sync_last_at', value || null);
  idbSet('sync_last_at', value || null);
};

const saveMbiSnapshot = async (backupPayload) => idbSet('mbi_snapshot', backupPayload || null);

const clearAllClientData = async () => {
  memoryStore.clear();

  if (storageState.localStorageAvailable) {
    try {
      Object.values(cacheKeys).forEach((key) => window.localStorage.removeItem(key));
      ['lastBackup', 'lastBackupAt', 'mbi_snapshot', 'operatorCode', 'operatorName', 'sync_last_at', BACKUP_HISTORY_KEY]
        .forEach((key) => window.localStorage.removeItem(key));
    } catch (error) {
      storageState.lastError = error?.message || 'local_storage_clear_error';
    }
  }

  const db = await openDb();
  if (db) {
    await new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }
};

const subscribeStorageUpdates = (listener) => {
  assertFunction(listener);
  listeners.add(listener);
  return () => listeners.delete(listener);
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
