import { describe, expect, it } from 'vitest';
import { parseInventoryRows, validateInventoryHeaders } from './inventoryImport';

describe('inventory import parser', () => {
  it('validates required headers in order', () => {
    const valid = validateInventoryHeaders([
      'POSIZIONE',
      'CODICE',
      'DESCRIZIONE',
      'PREZZO AL PUBBLICO',
      'QUANTITA'
    ]);
    const invalid = validateInventoryHeaders(['CODICE', 'POSIZIONE']);

    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
  });

  it('parses european price formats and detects duplicates', () => {
    const rows = [
      {
        POSIZIONE: 'A1',
        CODICE: 'X1',
        DESCRIZIONE: 'Filtro',
        'PREZZO AL PUBBLICO': '12,50',
        QUANTITA: '3'
      },
      {
        POSIZIONE: 'A2',
        CODICE: 'X1',
        DESCRIZIONE: 'Cinghia',
        'PREZZO AL PUBBLICO': '9.90',
        QUANTITA: '2'
      }
    ];

    const entries = parseInventoryRows(rows);
    expect(entries[0].price).toBeCloseTo(12.5, 2);
    expect(entries[1].errors).toContain('CODICE duplicato nel file');
  });

  it('flags missing fields and non numeric values', () => {
    const rows = [
      {
        POSIZIONE: '',
        CODICE: '',
        DESCRIZIONE: '',
        'PREZZO AL PUBBLICO': 'abc',
        QUANTITA: '-1'
      }
    ];

    const entries = parseInventoryRows(rows);
    expect(entries[0].errors).toEqual(expect.arrayContaining([
      'CODICE mancante',
      'DESCRIZIONE mancante',
      'PREZZO AL PUBBLICO non valido',
      'QUANTITA non valida'
    ]));
  });

  it('marks existing codes as update without error', () => {
    const rows = [
      {
        POSIZIONE: 'B1',
        CODICE: 'EXIST',
        DESCRIZIONE: 'Pompa',
        'PREZZO AL PUBBLICO': '10',
        QUANTITA: '1'
      }
    ];

    const entries = parseInventoryRows(rows, { existingCodes: new Set(['EXIST']) });
    expect(entries[0].status).toBe('update');
    expect(entries[0].errors).toHaveLength(0);
  });
});
