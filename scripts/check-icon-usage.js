import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(process.cwd(), 'src');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

const issues = [];

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;

    const content = fs.readFileSync(fullPath, 'utf8');

    if (/\bfa\s*\(/.test(content)) {
      issues.push(`${path.relative(process.cwd(), fullPath)}: trovato uso non valido di fa(...)`);
    }

    if (/from\s+['\"]react-icons\/fa['\"]/.test(content) && /import\s*\{[^}]*\bfa[A-Z]\w*/.test(content)) {
      issues.push(`${path.relative(process.cwd(), fullPath)}: import errato da react-icons/fa (usa componenti con prefisso Fa...)`);
    }
  }
};

walk(ROOT_DIR);

if (issues.length > 0) {
  console.error('Controllo icone fallito:\n');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('Controllo icone OK: nessun uso di fa(...) rilevato.');
