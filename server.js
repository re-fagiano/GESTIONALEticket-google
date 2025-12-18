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

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

const sendJson = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

const serveFile = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_MAP[ext] || 'application/octet-stream'
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  fs.createReadStream(filePath).pipe(res)
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
    const cleanPath = req.url.split('?')[0]
    const requested = path.join(DIST_DIR, cleanPath)

    if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
      serveFile(res, requested)
      return
    }

    if (fs.existsSync(DIST_INDEX)) {
      serveFile(res, DIST_INDEX)
      return
    }

    res.statusCode = 404
    res.end('Not Found')
    return
  }

  res.statusCode = 405
  res.end('Method Not Allowed')
})

server.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`)
  if (!fs.existsSync(DIST_DIR) || !fs.existsSync(DIST_INDEX)) {
    console.warn('Attenzione: cartella dist mancante. Esegui `npm start` o `npm run build` prima di visitare l’app.')
  }
})
