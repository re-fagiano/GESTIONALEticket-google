/* eslint-env node */
import http from 'node:http'
import process from 'node:process'
import path from 'node:path'
import fs from 'node:fs'

const PORT = process.env.PORT || 4173
const DEEPSEEK_API_URL = (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim()
const DIST_DIR = path.join(process.cwd(), 'dist')
const DIST_INDEX = path.join(DIST_DIR, 'index.html')
const hasBuiltAssets = () => fs.existsSync(DIST_DIR) && fs.existsSync(DIST_INDEX)

const sendJson = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

const handleProxy = async (req, res, body) => {
  if (!DEEPSEEK_API_KEY) {
    sendJson(res, 500, { error: 'DEEPSEEK_API_KEY non configurata lato server.' })
    return
  }

  try {
    const upstream = `${DEEPSEEK_API_URL}/chat/completions`
    const response = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(body || {}),
    })

    const text = await response.text()
    let payload = text
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }

    sendJson(res, response.status, payload)
  } catch (error) {
    sendJson(res, 502, { error: error?.message || 'Errore durante la chiamata a DeepSeek.' })
  }
}

const serveStatic = (req, res) => {
  if (!hasBuiltAssets()) {
    sendJson(res, 503, { error: 'L’app non è stata ancora costruita. Esegui `npm run build` o usa `npm start` che effettua la build automaticamente.' })
    return
  }

  const filePath = path.join(DIST_DIR, req.url.split('?')[0])
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const stream = fs.createReadStream(filePath)
    stream.pipe(res)
    return
  }

  if (fs.existsSync(DIST_INDEX)) {
    fs.createReadStream(DIST_INDEX).pipe(res)
    return
  }

  res.statusCode = 404
  res.end('Not Found')
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/deepseek')) {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let parsed = {}
      if (body) {
        try {
          parsed = JSON.parse(body)
        } catch {
          sendJson(res, 400, { error: 'Corpo JSON non valido.' })
          return
        }
      }
      handleProxy(req, res, parsed)
    })
    return
  }

  if (req.method === 'GET') {
    serveStatic(req, res)
    return
  }

  res.statusCode = 405
  res.end('Method Not Allowed')
})

server.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`)
  if (!hasBuiltAssets()) {
    console.warn('Attenzione: cartella dist mancante. Esegui `npm start` o `npm run build` prima di provare a visitare l’app.')
  }
})
