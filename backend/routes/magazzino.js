import express from 'express';
import db from '../db/database.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM magazzino').all());
});

router.post('/', (req, res) => {
  const { nome, quantita, prezzo } = req.body;

  const result = db.prepare(`
    INSERT INTO magazzino (nome, quantita, prezzo)
    VALUES (?, ?, ?)
  `).run(nome, quantita, prezzo);

  res.json({ id: result.lastInsertRowid });
});

export default router;
