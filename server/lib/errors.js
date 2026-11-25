export class HttpError extends Error {
  constructor(status, message, code = 'request_error', extra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const badRequest = (message, code = 'bad_request', extra) => new HttpError(400, message, code, extra)
export const notFound = (message = 'Risorsa non trovata.', code = 'not_found') => new HttpError(404, message, code)
export const forbidden = (message = 'Permessi insufficienti per questa operazione.', code = 'forbidden') => new HttpError(403, message, code)
export const conflict = (message, current) => new HttpError(409, message, 'conflict', { current })

// Express 4 non intercetta le promise rifiutate: questo wrapper le inoltra al gestore errori.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}
