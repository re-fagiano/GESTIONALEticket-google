const memoryStore = new Map();
const listeners = new Set();

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

const readRawSync = (key, fallback = null) => (memoryStore.has(key) ? memoryStore.get(key) : fallback);

const writeRaw = (key, value, shouldNotify = false) => {
  memoryStore.set(key, value);
  if (shouldNotify) notify(key);
  return true;
};

const saveCache = (key, value) => writeRaw(cacheKeys[key], value);
const loadCache = (key, fallback) => readRawSync(cacheKeys[key], fallback);
const loadCacheFromIdb = async (key, fallback) => loadCache(key, fallback);

const saveBackup = (backupPayload) => {
  writeRaw('lastBackup', backupPayload || null);
  writeRaw('lastBackupAt', backupPayload?.exportedAt || null);
  return true;
};

const loadBackupSync = () => readRawSync('lastBackup', null);
const loadBackupFromIdb = async () => loadBackupSync();
const loadBackupAtSync = () => readRawSync('lastBackupAt', null);
const loadBackupAtFromIdb = async () => loadBackupAtSync();
const loadLatestValidBackup = async () => loadBackupSync();

const getStorageState = () => ({
  localStorageAvailable: false,
  fallbackActive: false,
  lastError: null
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
const setLastSyncAt = (value) => writeRaw('sync_last_at', value || null);

const saveMbiSnapshot = async (backupPayload) => {
  writeRaw('mbi_snapshot', backupPayload || null);
  return true;
};

const clearAllClientData = async () => {
  memoryStore.clear();
};

const idbGet = async (key) => readRawSync(key, null);
const idbSet = async (key, value) => {
  writeRaw(key, value);
  return true;
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
