import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db/database.js';
import ticketsRouter from './routes/tickets.js';
import clientiRouter from './routes/clienti.js';
import magazzinoRouter from './routes/magazzino.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

app.use(express.json());

app.use('/api/tickets', ticketsRouter);
app.use('/api/clienti', clientiRouter);
app.use('/api/magazzino', magazzinoRouter);

// Alias per compatibilità frontend corrente
app.get('/api/customers', (req, res) => {
  const rows = db.prepare('SELECT id, nome AS name, telefono AS phone, email, indirizzo AS address, created_at AS createdAt FROM clienti ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/customers', (req, res) => {
  const { name, phone, email, address } = req.body || {};
  const result = db.prepare('INSERT INTO clienti (nome, telefono, email, indirizzo) VALUES (?, ?, ?, ?)').run(name, phone, email, address);
  const row = db.prepare('SELECT id, nome AS name, telefono AS phone, email, indirizzo AS address, created_at AS createdAt FROM clienti WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.get('/api/inventory', (req, res) => {
  const rows = db.prepare('SELECT id, nome AS name, quantita AS qty, prezzo AS price FROM magazzino ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/inventory', (req, res) => {
  const { name, qty, price } = req.body || {};
  const result = db.prepare('INSERT INTO magazzino (nome, quantita, prezzo) VALUES (?, ?, ?)').run(name, Number(qty || 0), Number(price || 0));
  const row = db.prepare('SELECT id, nome AS name, quantita AS qty, prezzo AS price FROM magazzino WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server avviato su http://localhost:${PORT}`);
});
