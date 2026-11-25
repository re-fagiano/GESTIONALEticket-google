import { Router } from 'express'
import { asyncHandler, HttpError } from '../lib/errors.js'

const FALLBACK = 'Diagnosi fallback: AI non disponibile. Verifica alimentazione, cablaggi, componenti principali e prova funzionale prima di ordinare ricambi.'

const readUpstream = async (response) => {
  const text = await response.text()
  try { return JSON.parse(text) } catch { return text }
}

// Proxy verso DeepSeek e verso il servizio RAG: le chiavi restano sul server.
export const aiRoutes = ({ config, fetchImpl = globalThis.fetch }) => {
  const router = Router()

  router.post('/deepseek', asyncHandler(async (req, res) => {
    if (!config.DEEPSEEK_API_KEY) {
      return res.json({ choices: [{ message: { content: FALLBACK } }], fallback: true, reason: 'DEEPSEEK_API_KEY missing' })
    }
    let response
    try {
      response = await fetchImpl(`${config.DEEPSEEK_API_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.DEEPSEEK_API_KEY}` },
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      throw new HttpError(502, error.message || 'Errore durante la chiamata a DeepSeek.', 'deepseek_proxy_error')
    }
    const parsed = await readUpstream(response)
    if (!response.ok && [401, 402, 403, 429].includes(response.status)) {
      return res.json({ choices: [{ message: { content: FALLBACK } }], fallback: true, reason: `deepseek_upstream_${response.status}`, upstreamStatus: response.status })
    }
    return res.status(response.status).json(parsed)
  }))

  router.post('/rag', asyncHandler(async (req, res) => {
    if (!config.RAG_API_URL) throw new HttpError(503, 'RAG_API_URL non configurata lato server.', 'rag_not_configured')
    let response
    try {
      response = await fetchImpl(config.RAG_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      throw new HttpError(502, error.message || 'Errore durante la chiamata RAG.', 'rag_proxy_error')
    }
    return res.status(response.status).json(await readUpstream(response))
  }))

  return router
}
