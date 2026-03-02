import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const TARGET_DIRECTORIES = ['src', 'backend'];
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);

const issues = [];

const inspectFile = (fullPath) => {
  if (!SOURCE_EXTENSIONS.has(path.extname(fullPath))) return;

  const content = fs.readFileSync(fullPath, 'utf8');

  if (/\bfa\s*\(/.test(content)) {
    issues.push(`${path.relative(process.cwd(), fullPath)}: trovato uso non valido di fa(...)`);
  }

  if (/\bfa\s*\.[A-Za-z_$][\w$]*\s*\(/.test(content)) {
    issues.push(`${path.relative(process.cwd(), fullPath)}: trovato uso non valido di fa.<metodo>(...)`);
  }

  if (/\bfa[A-Z]\w*\s*\(/.test(content)) {
    issues.push(`${path.relative(process.cwd(), fullPath)}: trovato uso non valido di icona chiamata come funzione (es. faPlus())`);
  }

  if (/from\s+['\"]react-icons\/fa(?:6)?['\"]/.test(content) && /import\s*\{[^}]*\bfa[A-Z]\w*/.test(content)) {
    issues.push(`${path.relative(process.cwd(), fullPath)}: import errato da react-icons/fa (usa componenti con prefisso Fa...)`);
  }

  if (/from\s+['\"]date-fns\/locale\/(?:fa|fa-IR)['\"]/.test(content) && /\bfa\s*\(/.test(content)) {
    issues.push(`${path.relative(process.cwd(), fullPath)}: locale date-fns fa/fa-IR usata come funzione (usa { locale: faIR })`);
  }
};

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      walk(fullPath);
      continue;
    }

    inspectFile(fullPath);
  }
};

for (const relativeDir of TARGET_DIRECTORIES) {
  const fullDir = path.join(ROOT_DIR, relativeDir);
  if (fs.existsSync(fullDir)) {
    walk(fullDir);
  }
}

if (issues.length > 0) {
  console.error('Controllo icone fallito:\n');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('Controllo icone OK: nessun uso non valido di icone FontAwesome rilevato.');
