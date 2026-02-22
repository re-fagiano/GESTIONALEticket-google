import express from 'express';
import db from '../db/database.js';

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all().map((row) => ({
    ...row,
    customerId: row.cliente_id ? String(row.cliente_id) : '',
    type: row.tipo || 'chiamata',
    status: row.stato || 'aperto',
    description: row.descrizione || '',
    urgency: Number(row.urgenza || 2),
    subject: row.descrizione || `Ticket #${row.id}`,
    date: String(row.created_at || '').slice(0, 10),
    time: '09:00',
    updatedAt: row.created_at,
  }));
  res.json(rows);
});

router.post('/', (req, res) => {
  const { cliente_id, tipo, stato, descrizione, urgenza, customerId, type, status, description, urgency, subject } = req.body || {};

  const stmt = db.prepare(`
    INSERT INTO tickets (cliente_id, tipo, stato, descrizione, urgenza)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    cliente_id ?? customerId ?? null,
    tipo ?? type ?? 'chiamata',
    stato ?? status ?? 'aperto',
    descrizione ?? description ?? subject ?? '',
    urgenza ?? urgency ?? 2,
  );

  res.json({ id: result.lastInsertRowid });
});

export default router;
