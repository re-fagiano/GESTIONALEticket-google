import fs from 'node:fs'
import path from 'node:path'

const ROOT_DIR = process.cwd()
const INCLUDE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', '.vite', 'coverage'])

const DANGEROUS_PATTERNS = [
  { name: 'eval', pattern: /\beval\s*\(/g, message: 'Uso di eval() rilevato.' },
  { name: 'Function-constructor', pattern: /\bnew\s+Function\s*\(/g, message: 'Uso di new Function() rilevato.' },
  { name: 'setTimeout-string', pattern: /\bsetTimeout\s*\(\s*['"`]/g, message: 'setTimeout con stringa rilevato.' },
  { name: 'setInterval-string', pattern: /\bsetInterval\s*\(\s*['"`]/g, message: 'setInterval con stringa rilevato.' },
  { name: 'innerHTML-assignment', pattern: /\.innerHTML\s*=/g, message: 'Assegnazione a innerHTML rilevata.' },
  { name: 'dangerouslySetInnerHTML', pattern: /\bdangerouslySetInnerHTML\b/g, message: 'Uso di dangerouslySetInnerHTML rilevato.' },
  { name: 'shell-true', pattern: /\bshell\s*:\s*true\b/g, message: 'shell:true rilevato: verificare input utente.' },
]

const collectFiles = (dirPath) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue
      files.push(...collectFiles(fullPath))
      continue
    }
    if (!entry.isFile()) continue
    if (!INCLUDE_EXTENSIONS.has(path.extname(entry.name))) continue
    files.push(fullPath)
  }
  return files
}

const violations = []
const sourceFiles = collectFiles(ROOT_DIR)

for (const filePath of sourceFiles) {
  if (path.relative(ROOT_DIR, filePath) === 'scripts/security-static-check.js') continue
  const source = fs.readFileSync(filePath, 'utf8')
  for (const check of DANGEROUS_PATTERNS) {
    check.pattern.lastIndex = 0
    let match = check.pattern.exec(source)
    while (match) {
      const sourceBefore = source.slice(0, match.index)
      const line = sourceBefore.split('\n').length
      const relativePath = path.relative(ROOT_DIR, filePath)
      violations.push({
        file: relativePath,
        line,
        name: check.name,
        message: check.message,
      })
      match = check.pattern.exec(source)
    }
  }
}

if (violations.length > 0) {
  console.error('Security static check: rilevati pattern potenzialmente pericolosi.')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.name}] ${violation.message}`)
  }
  process.exit(1)
}

console.log(`Security static check: OK (${sourceFiles.length} file analizzati).`)
