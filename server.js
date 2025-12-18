/* eslint-env node */
import http from 'node:http'
import process from 'node:process'
import path from 'node:path'
import fs from 'node:fs'

const PORT = process.env.PORT || 4173
const DEEPSEEK_API_URL = (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim()
const DIST_DIR = path.join(process.cwd(), 'dist')
const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8'
}

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

const serveStatic = (req, res, isHead = false) => {
  const cleanPath = req.url.split('?')[0]
  const filePath = path.join(DIST_DIR, cleanPath)
  const fileExists = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  const target = fileExists ? filePath : path.join(DIST_DIR, 'index.html')

  if (!fs.existsSync(target)) {
    res.statusCode = 404
    res.end('Not Found')
    return
  }

  const ext = path.extname(target).toLowerCase()
  const contentType = MIME_MAP[ext] || 'application/octet-stream'
  res.setHeader('Content-Type', contentType)

  if (isHead) {
    res.statusCode = 200
    res.end()
    return
  }

  fs.createReadStream(target).pipe(res)
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

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, req.method === 'HEAD')
    return
  }

  res.statusCode = 405
  res.end('Method Not Allowed')
})

server.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`)
})
