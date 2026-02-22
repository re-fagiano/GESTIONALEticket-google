import express from 'express';
import db from '../db/database.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM clienti').all());
});

router.post('/', (req, res) => {
  const { nome, telefono, email, indirizzo } = req.body;

  const result = db.prepare(`
    INSERT INTO clienti (nome, telefono, email, indirizzo)
    VALUES (?, ?, ?, ?)
  `).run(nome, telefono, email, indirizzo);

  res.json({ id: result.lastInsertRowid });
});

export default router;
