import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/App.jsx');
const source = fs.readFileSync(filePath, 'utf8');

const checks = [
  { name: 'openInterventionDetails', pattern: /const\s+openInterventionDetails\s*=\s*\(/g },
  { name: 'handleSaveInterventionDetails', pattern: /const\s+handleSaveInterventionDetails\s*=\s*async\s*\(/g }
];

const violations = checks
  .map(({ name, pattern }) => {
    const matches = source.match(pattern) || [];
    return { name, count: matches.length };
  })
  .filter((entry) => entry.count !== 1);

if (violations.length > 0) {
  console.error('Errore: dichiarazioni duplicate/mancanti in src/App.jsx');
  violations.forEach(({ name, count }) => {
    console.error(`- ${name}: trovate ${count} dichiarazioni (attesa: 1)`);
  });
  process.exit(1);
}

console.log('Controllo duplicati handlers intervento: OK');
