/* eslint-env node */
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT || 4173
const rawDeepSeekUrl = process.env.DEEPSEEK_API_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const DEEPSEEK_API_URL = rawDeepSeekUrl.replace(/\/$/, '')
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DIST_DIR = path.join(__dirname, 'dist')
const DIST_INDEX = path.join(DIST_DIR, 'index.html')

const app = express()

app.use(express.json())

// Serve assets from Vite build
app.use(express.static(DIST_DIR))

// Proxy DeepSeek API calls
app.post('/api/deepseek', async (req, res) => {
  if (!DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: 'DEEPSEEK_API_KEY non configurata lato server.' })
  }

  try {
    const upstream = `${DEEPSEEK_API_URL}/chat/completions`
    const response = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify(req.body || {}),
    })

    const text = await response.text()
    let payload = text
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }

    res.status(response.status).json(payload)
  } catch (error) {
    res.status(502).json({ error: error?.message || 'Errore durante la chiamata a DeepSeek.' })
  }
})

// React routing fallback
app.get('*', (req, res) => {
  res.sendFile(DIST_INDEX)
})

app.listen(PORT, () => {
  console.log(`Server avviato su http://localhost:${PORT}`)
})
