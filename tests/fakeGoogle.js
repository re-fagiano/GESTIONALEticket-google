// Finto Google (OAuth + Calendar + Drive) in memoria, da passare come fetchImpl al client Google.
// Permette anche di simulare le azioni di una persona su Google Calendar (sposta, crea, elimina).

export const createFakeGoogle = ({ email = 'negozio@gmail.com' } = {}) => {
  let seq = 0
  let idCounter = 0
  const events = new Map() // id -> { event, seq }
  const calls = []
  const driveFiles = []
  let failNext = null

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const touch = (event) => {
    seq += 1
    event.etag = `"etag-${seq}"`
    event.updated = new Date(Date.now() + seq).toISOString()
    events.set(event.id, { event, seq })
    return event
  }
  const idToken = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ email })).toString('base64url') + '.x'

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method || 'GET').toUpperCase()
    calls.push(`${method} ${url.pathname}`)
    if (failNext && url.pathname.includes(failNext.match)) { const f = failNext; failNext = null; return json(f.status, { error: { message: f.message || 'errore simulato' } }) }

    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const body = new URLSearchParams(String(init.body))
      if (body.get('grant_type') === 'authorization_code') {
        return json(200, { access_token: 'access-1', refresh_token: 'refresh-abc', expires_in: 3600, id_token: idToken, scope: 'openid email https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file' })
      }
      if (body.get('grant_type') === 'refresh_token' && body.get('refresh_token') === 'refresh-abc') return json(200, { access_token: 'access-2', expires_in: 3600 })
      return json(400, { error: 'invalid_grant' })
    }
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') return json(200, {})

    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      return json(200, { items: [{ id: 'primary-id', summary: email, primary: true }, { id: 'interventi@group.calendar.google.com', summary: 'Interventi FixLab' }] })
    }

    const match = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/)
    if (match) {
      const calendarId = decodeURIComponent(match[1])
      const eventId = match[2] ? decodeURIComponent(match[2]) : null
      const body = init.body ? JSON.parse(init.body) : null
      if (method === 'POST') {
        idCounter += 1
        const event = touch({ ...body, id: `ev${idCounter}`, status: 'confirmed', calendarId, htmlLink: `https://calendar.google.com/event?eid=ev${idCounter}` })
        return json(200, event)
      }
      if (method === 'PATCH') {
        const current = events.get(eventId)
        if (!current || current.event.status === 'cancelled') return json(404, { error: { message: 'Not Found' } })
        return json(200, touch({ ...current.event, ...body }))
      }
      if (method === 'DELETE') {
        const current = events.get(eventId)
        if (!current || current.event.status === 'cancelled') return json(410, { error: { message: 'Resource has been deleted' } })
        touch({ ...current.event, status: 'cancelled' })
        return new Response(null, { status: 204 })
      }
      if (method === 'GET') {
        const syncToken = url.searchParams.get('syncToken')
        if (syncToken === 'scaduto') return json(410, { error: { message: 'Sync token is no longer valid' } })
        const since = syncToken ? Number(syncToken) : 0
        const showDeleted = Boolean(syncToken) || url.searchParams.get('showDeleted') === 'true'
        const items = [...events.values()]
          .filter((entry) => entry.seq > since && entry.event.calendarId === calendarId && (showDeleted || entry.event.status !== 'cancelled'))
          .map((entry) => entry.event)
        return json(200, { items, nextSyncToken: String(seq) })
      }
    }

    if (url.pathname === '/drive/v3/files' && method === 'GET') return json(200, { files: [] })
    if (url.pathname === '/drive/v3/files' && method === 'POST') return json(200, { id: 'folder-1' })
    if (url.pathname === '/upload/drive/v3/files') { driveFiles.push(String(init.body).length); return json(200, { id: `file-${driveFiles.length}`, name: 'backup.json' }) }

    return json(404, { error: { message: `fake google: ${method} ${url.pathname} non gestito` } })
  }

  const all = () => [...events.values()].map((entry) => entry.event)
  return {
    fetchImpl,
    calls,
    driveFiles,
    events: all,
    live: () => all().filter((event) => event.status !== 'cancelled'),
    find: (predicate) => all().find(predicate),
    failNextRequest: (match, status, message) => { failNext = { match, status, message } },
    userMove: (id, startIso, endIso) => {
      const current = events.get(id).event
      touch({ ...current, start: { dateTime: startIso, timeZone: 'Europe/Rome' }, end: { dateTime: endIso, timeZone: 'Europe/Rome' } })
    },
    userCreate: (calendarId, fields) => {
      idCounter += 1
      return touch({ id: `ev${idCounter}`, status: 'confirmed', calendarId, htmlLink: `https://calendar.google.com/event?eid=ev${idCounter}`, ...fields })
    },
    userDelete: (id) => touch({ ...events.get(id).event, status: 'cancelled' }),
  }
}
