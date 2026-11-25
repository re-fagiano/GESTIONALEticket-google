const dateFormatter = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const timeFormatter = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const number = new Intl.NumberFormat('it-IT')

const toDate = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const fmtDate = (value) => (toDate(value) ? dateFormatter.format(toDate(value)) : '—')
export const fmtDateTime = (value) => (toDate(value) ? dateTimeFormatter.format(toDate(value)) : '—')
export const fmtTime = (value) => (toDate(value) ? timeFormatter.format(toDate(value)) : '')
export const fmtEuro = (value) => euro.format(Number(value) || 0)
export const fmtNumber = (value) => number.format(Number(value) || 0)

// Valore per <input type="datetime-local"> nell'ora locale del browser.
export const toLocalInput = (value) => {
  const date = toDate(value) || new Date()
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)

export const relativeDays = (value) => {
  const date = toDate(value)
  if (!date) return ''
  const days = Math.round((date.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return 'oggi'
  if (days === 1) return 'domani'
  if (days === -1) return 'ieri'
  return days > 0 ? `tra ${days} giorni` : `${-days} giorni fa`
}

export const fileSize = (bytes = 0) => {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export const newId = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
