
const isBrowser = typeof window !== 'undefined';
const isLocalhost = isBrowser && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const forcedProxyEndpoint = '/api/deepseek';
const nowIso = () => new Date().toISOString();
const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const toLocalDateTimeInput = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const generateUserCode = () => `USR-${Math.random().toString(36).slice(2, 7).toUpperCase()}-${Date.now().toString().slice(-4)}`;

const formatAuditDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Data non disponibile';
  return date.toLocaleString('it-IT');
};

const getDescriptionEntries = (intervention) => {
  const entries = intervention?.additionalData?.descriptionEntries;
  if (Array.isArray(entries) && entries.length > 0) return entries;
  if (!intervention?.description?.trim()) return [];
  return [{
    id: `legacy-${intervention.id || Date.now()}`,
    text: intervention.description,
    authorCode: 'SYSTEM',
    authorName: 'Dato originale',
    createdAt: intervention.openedAt || intervention.updatedAt || nowIso(),
    source: 'original'
  }];
};

const buildDescriptionFromEntries = (entries = []) => entries.map((entry) => entry.text).filter(Boolean).join('\n');


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
    type: interventionTypes.includes(ticket.type) ? ticket.type : 'chiamata',
    urgency: [1, 2, 3].includes(Number(ticket.urgency)) ? Number(ticket.urgency) : 2,
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
    priceDate: typeof item.priceDate === 'string' ? item.priceDate : '',
    pendingSync: Boolean(item.pendingSync),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso(),
    version: Number.isFinite(Number(item.version)) ? Number(item.version) : 1
  };
};

const sanitizeInventoryList = (list, fallback = []) => {
  const source = Array.isArray(list) ? list : fallback;
  return source.map((item, idx) => sanitizeInventoryItem(item, idx)).filter(Boolean);
};

const interventionTypes = ['chiamata', 'riparazione', 'ordine_ricambi', 'preventivo'];
const interventionStatuses = ['pendente', 'in_lavorazione', 'completato', 'annullato'];
const interventionTypeMeta = {
  chiamata: { label: 'Chiamate', singularLabel: 'Chiamata', color: 'blue' },
  riparazione: { label: 'Riparazioni', singularLabel: 'Riparazione', color: 'indigo' },
  ordine_ricambi: { label: 'Ordini Ricambi', singularLabel: 'Ordine ricambi', color: 'amber' },
  preventivo: { label: 'Preventivi', singularLabel: 'Preventivo', color: 'emerald' }
};

const dedicatedTabToType = {
  chiamate: 'chiamata',
  riparazioni: 'riparazione',
  'ordine-ricambi': 'ordine_ricambi',
  'preventivi-nuovi': 'preventivo'
};

const mapInterventionStatusToTicketStatus = (status) => {
  if (status === 'completato' || status === 'annullato') return 'chiuso';
  if (status === 'pendente') return 'aperto';
  return 'in lavorazione';
};

const mapTicketStatusToInterventionStatus = (status, currentStatus) => {
  if (status === 'chiuso') return 'completato';
  if (status === 'aperto') return 'pendente';
  if (currentStatus && currentStatus !== 'completato' && currentStatus !== 'pendente') return currentStatus;
  return 'in_lavorazione';
};

const interventionToTicket = (intervention, index = 0) => {
  const openedAt = intervention?.openedAt || nowIso();
  const openedDate = new Date(openedAt);
  const safeDate = Number.isNaN(openedDate.getTime()) ? '' : openedDate.toISOString().split('T')[0];
  const safeTime = Number.isNaN(openedDate.getTime()) ? '09:00' : openedDate.toTimeString().slice(0, 5);
  const details = intervention?.additionalData || {};
  const fallbackSubject = `${interventionTypeMeta[intervention?.type]?.singularLabel || 'Intervento'} #${index + 1}`;
  const subject =
    typeof details.ticketSubject === 'string' && details.ticketSubject.trim()
      ? details.ticketSubject.trim()
      : (typeof intervention?.description === 'string' && intervention.description.trim()
        ? intervention.description.trim().slice(0, 80)
        : fallbackSubject);

  return sanitizeTicket({
    id: intervention.id,
    subject,
    description: intervention.description || '',
    customerId: intervention.clientId || '',
    status: mapInterventionStatusToTicketStatus(intervention.status),
    type: intervention.type,
    urgency: intervention.urgency,
    date: safeDate,
    time: safeTime,
    updatedAt: intervention.updatedAt || nowIso(),
    version: intervention.version || 1,
    sourceType: 'intervention',
    sourceStatus: intervention.status
  }, index);
};

const sanitizeIntervention = (item, idx = 0) => {
  if (!item || typeof item !== 'object') return null;
  return {
    id: item.id || `${Date.now()}-${idx}`,
    clientId: typeof item.clientId === 'string' ? item.clientId : '',
    type: interventionTypes.includes(item.type) ? item.type : 'chiamata',
    status: interventionStatuses.includes(item.status) ? item.status : 'pendente',
    urgency: [1, 2, 3].includes(Number(item.urgency)) ? Number(item.urgency) : 2,
    openedAt: typeof item.openedAt === 'string' ? item.openedAt : nowIso(),
    closedAt: typeof item.closedAt === 'string' ? item.closedAt : null,
    description: typeof item.description === 'string' ? item.description : '',
    parentInterventionId: typeof item.parentInterventionId === 'string' ? item.parentInterventionId : null,
    assignedToId: typeof item.assignedToId === 'string' ? item.assignedToId : '',
    updatedByUserId: typeof item.updatedByUserId === 'string' ? item.updatedByUserId : '',
    additionalData: item.additionalData && typeof item.additionalData === 'object' ? item.additionalData : {},
    logs: Array.isArray(item.logs) ? item.logs : [],
    durationDays: Number.isFinite(Number(item.durationDays)) ? Number(item.durationDays) : 0,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso(),
    version: Number.isFinite(Number(item.version)) ? Number(item.version) : 1
  };
};

const sanitizeInterventions = (list, fallback = []) => {
  const source = Array.isArray(list) ? list : fallback;
  return source.map((entry, idx) => sanitizeIntervention(entry, idx)).filter(Boolean);
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
  { id: 'p1', code: 'POM-001', name: 'Pompa Scarico Universale', description: 'Pompa Scarico Universale', location: 'AF-01-A', qty: 3, price: 25.00, minQty: 5, priceDate: new Date().toISOString().split('T')[0] },
  { id: 'p2', code: 'CUS-002', name: 'Cuscinetti Cestello', description: 'Cuscinetti Cestello', location: 'BF-02-C', qty: 10, price: 15.50, minQty: 2, priceDate: new Date().toISOString().split('T')[0] },
  { id: 'p3', code: 'SCH-003', name: 'Scheda Elettronica Samsung', description: 'Scheda Elettronica Samsung', location: 'SEC-09', qty: 1, price: 120.00, minQty: 1, priceDate: new Date().toISOString().split('T')[0] }
];

const initialInterventions = [
  {
    id: 'int-101',
    clientId: '1',
    type: 'chiamata',
    status: 'pendente',
    urgency: 2,
    openedAt: new Date().toISOString(),
    description: 'Richiesta sopralluogo per lavatrice rumorosa',
    additionalData: {}
  }
];


export {
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
  mapInterventionStatusToTicketStatus,
  mapTicketStatusToInterventionStatus,
  interventionToTicket,
  sanitizeIntervention,
  sanitizeInterventions,
  parseCsvRows,
  initialCustomers,
  initialTickets,
  initialInventory,
  initialInterventions
};
