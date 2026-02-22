const isBrowser = typeof window !== 'undefined';
const storageAvailable = isBrowser && typeof window.localStorage !== 'undefined';

const IDB_DB_NAME = 'gestionale_storage';
const IDB_STORE = 'keyval';
const STORAGE_VERSION = 2;
const BACKUP_HISTORY_LIMIT = 5;

const fallbackState = {
  active: false,
  lastError: null
};

const cacheKeys = {
  customers: 'cache_customers',
  tickets: 'cache_tickets',
  interventions: 'cache_interventions',
  sparePartsOrders: 'cache_spare_parts_orders',
  quotes: 'cache_quotes',
  inventory: 'cache_inventory',
  settings: 'cache_settings'
};

const warnStorage = (message, error) => {
  fallbackState.active = true;
  fallbackState.lastError = error || new Error(message);
  console.warn(message, error);
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

const parseVersionedPayload = (raw, fallback) => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === 'object'
      && Number.isFinite(Number(parsed.storageVersion))
      && Object.prototype.hasOwnProperty.call(parsed, 'data')
    ) {
      return parsed.data;
    }
    return parsed;
  } catch (error) {
    warnStorage('Errore parsing storage locale, uso fallback', error);
    return fallback;
  }
};

const wrapVersionedPayload = (data) => JSON.stringify({
  storageVersion: STORAGE_VERSION,
  savedAt: new Date().toISOString(),
  data
});

const readRawSync = (key, fallback = null) => {
  if (!storageAvailable) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (error) {
    warnStorage('Storage non accessibile, uso fallback', error);
    return fallback;
  }
};

const writeRaw = (key, value) => {
  let written = false;
  if (!storageAvailable) {
    warnStorage('localStorage non disponibile, uso IndexedDB');
  } else {
    try {
      window.localStorage.setItem(key, value);
      written = true;
    } catch (error) {
      warnStorage('Impossibile scrivere su localStorage, fallback su IndexedDB', error);
    }
  }

  idbSet(key, value).catch((error) => warnStorage('Scrittura su IndexedDB fallita', error));
  return written;
};

const readJsonSync = (key, fallback) => parseVersionedPayload(readRawSync(key, null), fallback);

const writeJson = (key, value) => writeRaw(key, wrapVersionedPayload(value));

const readJsonFromIdb = async (key, fallback) => {
  try {
    const raw = await idbGet(key);
    return parseVersionedPayload(raw, fallback);
  } catch (error) {
    warnStorage('Lettura da IndexedDB fallita', error);
    return fallback;
  }
};

const saveCache = (key, value) => writeJson(cacheKeys[key], value);

const loadCache = (key, fallback) => readJsonSync(cacheKeys[key], fallback);

const loadCacheFromIdb = (key, fallback) => readJsonFromIdb(cacheKeys[key], fallback);

const saveBackup = (backupPayload) => {
  const exportedAt = backupPayload?.exportedAt || new Date().toISOString();
  const versionedBackup = {
    ...backupPayload,
    exportedAt,
    storageVersion: STORAGE_VERSION
  };
  const raw = JSON.stringify(versionedBackup);
  const saved = writeRaw('lastBackup', raw);
  writeRaw('lastBackupAt', exportedAt);

  const history = readJsonSync('backup_history_v2', []);
  const safeHistory = Array.isArray(history) ? history : [];
  const nextHistory = [versionedBackup, ...safeHistory].slice(0, BACKUP_HISTORY_LIMIT);
  writeJson('backup_history_v2', nextHistory);
  return saved;
};

const loadBackupSync = () => {
  const fallback = null;
  const raw = readRawSync('lastBackup', null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    warnStorage('Backup locale corrotto', error);
    return fallback;
  }
};

const loadBackupFromIdb = async () => {
  try {
    const raw = await idbGet('lastBackup');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    warnStorage('Backup IndexedDB non disponibile', error);
    return null;
  }
};

const loadBackupAtSync = () => readRawSync('lastBackupAt', null);
const loadBackupAtFromIdb = async () => {
  try {
    return await idbGet('lastBackupAt');
  } catch (error) {
    warnStorage('Timestamp backup IndexedDB non disponibile', error);
    return null;
  }
};

const getStorageState = () => ({
  localStorageAvailable: storageAvailable,
  fallbackActive: fallbackState.active,
  lastError: fallbackState.lastError
});

export {
  cacheKeys,
  getStorageState,
  idbGet,
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
};
