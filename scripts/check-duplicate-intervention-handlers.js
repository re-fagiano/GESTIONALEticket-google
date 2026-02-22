import fs from 'node:fs';
import path from 'node:path';

const candidatePaths = [
  path.resolve('src/App.jsx'),
  path.resolve('src/pages/AppPage.jsx'),
];

const existingPaths = candidatePaths.filter((filePath) => fs.existsSync(filePath));

if (existingPaths.length === 0) {
  console.error('Errore: nessun file App trovato per il controllo handlers intervento.');
  process.exit(1);
}

const checks = [
  { name: 'openInterventionDetails', pattern: /const\s+openInterventionDetails\s*=\s*\(/g },
  { name: 'handleSaveInterventionDetails', pattern: /const\s+handleSaveInterventionDetails\s*=\s*async\s*\(/g }
];

let selectedPath = null;
let violations = [];

for (const filePath of existingPaths) {
  const source = fs.readFileSync(filePath, 'utf8');
  const currentViolations = checks
    .map(({ name, pattern }) => {
      const matches = source.match(pattern) || [];
      return { name, count: matches.length };
    })
    .filter((entry) => entry.count !== 1);

  if (currentViolations.length === 0) {
    selectedPath = filePath;
    violations = [];
    break;
  }

  if (!selectedPath) {
    selectedPath = filePath;
    violations = currentViolations;
  }
}

if (violations.length > 0) {
  console.error(`Errore: dichiarazioni duplicate/mancanti in ${path.relative(process.cwd(), selectedPath)}`);
  violations.forEach(({ name, count }) => {
    console.error(`- ${name}: trovate ${count} dichiarazioni (attesa: 1)`);
  });
  process.exit(1);
}

console.log(`Controllo duplicati handlers intervento: OK (${path.relative(process.cwd(), selectedPath)})`);
