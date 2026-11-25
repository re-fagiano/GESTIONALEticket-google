const SENSITIVE = /password|token|secret|authorization|cookie|private_?key/i

const mask = (value) => {
  if (Array.isArray(value)) return value.map(mask)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE.test(key) ? '***' : mask(item)]))
}

const write = (level, message, context = {}) => {
  if (process.env.LOG_SILENT === '1') return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...mask(context) })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
}
