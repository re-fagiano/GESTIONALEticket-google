import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export const INVENTORY_HEADERS = [
  'POSIZIONE',
  'CODICE',
  'DESCRIZIONE',
  'PREZZO AL PUBBLICO',
  'QUANTITA'
];

const normalizedExpectedHeaders = INVENTORY_HEADERS.map((header) => header.trim().toUpperCase());

export const normalizeHeader = (value) => (value ?? '').toString().trim().toUpperCase();

export const validateInventoryHeaders = (headers = []) => {
  const normalized = headers.map(normalizeHeader);
  const hasAll = normalized.length === normalizedExpectedHeaders.length &&
    normalized.every((header, index) => header === normalizedExpectedHeaders[index]);
  if (hasAll) {
    return { valid: true, message: null };
  }
  return {
    valid: false,
    message: `Intestazioni non valide. Attese: ${INVENTORY_HEADERS.join(', ')}.`
  };
};

const normalizeValue = (value) => (value ?? '').toString().trim();

const parsePriceValue = (value) => {
  const normalized = normalizeValue(value).replace(',', '.');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseQuantityValue = (value) => {
  const normalized = normalizeValue(value);
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const buildRowMap = (row) => {
  const mapped = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    mapped[normalizeHeader(key)] = value;
  });
  return mapped;
};

const isRowEmpty = (rowMap) => Object.values(rowMap).every((value) => normalizeValue(value) === '');

export const parseInventoryRows = (rows = [], { existingCodes = new Set() } = {}) => {
  const entries = [];
  const seenCodes = new Set();

  rows.forEach((row, index) => {
    const rowMap = buildRowMap(row);
    if (isRowEmpty(rowMap)) return;

    const errors = [];
    const code = normalizeValue(rowMap['CODICE']);
    const description = normalizeValue(rowMap['DESCRIZIONE']);
    const location = normalizeValue(rowMap['POSIZIONE']);

    if (!code) {
      errors.push('CODICE mancante');
    } else if (seenCodes.has(code)) {
      errors.push('CODICE duplicato nel file');
    }

    if (!description) {
      errors.push('DESCRIZIONE mancante');
    }

    const price = parsePriceValue(rowMap['PREZZO AL PUBBLICO']);
    if (price === null) {
      errors.push('PREZZO AL PUBBLICO non valido');
    }

    const quantity = parseQuantityValue(rowMap['QUANTITA']);
    if (quantity === null || !Number.isInteger(quantity)) {
      errors.push('QUANTITA non valida');
    }

    if (code) {
      seenCodes.add(code);
    }

    entries.push({
      rowIndex: index + 2,
      code,
      name: description,
      description,
      price,
      quantity,
      location,
      status: existingCodes.has(code) ? 'update' : 'new',
      errors
    });
  });

  return entries;
};

export const parseInventoryFile = async (file, existingCodes = new Set()) => {
  const extension = file?.name?.split('.').pop()?.toLowerCase();

  if (extension === 'xlsx') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const [headerRow, ...dataRows] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
    const validation = validateInventoryHeaders(headerRow || []);
    if (!validation.valid) {
      return { headerError: validation.message, entries: [] };
    }
    const rows = dataRows.map((row) => {
      const rowObj = {};
      INVENTORY_HEADERS.forEach((header, index) => {
        rowObj[header] = row[index] ?? '';
      });
      return rowObj;
    });
    return { headerError: null, entries: parseInventoryRows(rows, { existingCodes }) };
  }

  if (extension === 'csv') {
    const parsed = await new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results),
        error: (error) => reject(error)
      });
    });
    const validation = validateInventoryHeaders(parsed.meta.fields || []);
    if (!validation.valid) {
      return { headerError: validation.message, entries: [] };
    }
    return { headerError: null, entries: parseInventoryRows(parsed.data, { existingCodes }) };
  }

  return { headerError: 'Formato file non supportato. Usa CSV o XLSX.', entries: [] };
};
