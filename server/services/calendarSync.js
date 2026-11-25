import crypto from 'node:crypto'
import { GOOGLE_SCOPES, GoogleApiError } from './google.js'
import { newId } from '../db.js'

// Ponte bidirezionale tra il gestionale e Google Calendar.
//
//  App → Google: ogni intervento dei tipi scelti (default: chiamate) diventa un evento con cliente,
//                telefono, indirizzo e link alla scheda. Modifiche e annullamenti vengono propagati.
//  Google → App: sincronizzazione incrementale (syncToken). Se un evento del gestionale viene spostato
//                in Google, si sposta anche l'appuntamento; gli eventi creati direttamente in Google
//                compaiono nel calendario dell'app (calendar_items con source = 'google').
//
// Il collegamento tra i due mondi è nella tabella google_event_links. L'etag salvato a ogni scrittura
// evita i "rimbalzi": quando rileggiamo un evento che abbiamo appena scritto noi, lo ignoriamo.

export const CALENDAR_SETTINGS_KEY = 'google.calendar'
const STATE_KEY = 'google.calendar.state'
const DELETED_IN_GOOGLE = 'deleted_in_google'

export const CALENDAR_DEFAULTS = {
  enabled: false,
  calendarId: 'primary',
  pushTypes: ['chiamata'],
  importEvents: true,
  // Gli eventi creati a mano su Google (es. "Rossi via Roma 12" con telefono in descrizione) diventano chiamate.
  importAsCalls: true,
  // Colore evento Google → tecnico ({ '7': userId, default: userId }). Usato in entrambe le direzioni.
  colorOperators: {},
  // Data di attivazione: le chiamate create PRIMA non vengono inviate (probabilmente sono già scritte a mano su Google).
  pushSince: null,
  // Solo lettura: il gestionale legge Google Calendar ma non scrive/sposta/cancella mai nulla.
  // Predefinito alla prima attivazione: si toglie a mano dopo aver controllato che tutto vada bene.
  readOnly: true,
  defaultMinutes: 60,
  timeZone: 'Europe/Rome',
}

const TYPE_LABEL = { chiamata: 'Chiamata', riparazione: 'Riparazione', ordine_ricambi: 'Ordine ricambi', preventivo: 'Preventivo' }
const TYPE_ROUTE = { chiamata: 'chiamate', riparazione: 'riparazioni', ordine_ricambi: 'ordini', preventivo: 'preventivi' }
const STATUS_LABEL = { pendente: 'Da fare', in_lavorazione: 'In lavorazione', completato: 'Completato', annullato: 'Annullato' }
const URGENCY_LABEL = { 1: 'Bassa', 2: 'Media', 3: 'Alta' }
// Colori Google Calendar: 7 pavone, 3 vinaccia, 6 mandarino, 10 basilico, 11 pomodoro (urgente), 8 grafite (completato)
const TYPE_COLOR = { chiamata: '7', riparazione: '3', ordine_ricambi: '6', preventivo: '10' }

export const GOOGLE_EVENT_COLORS = {
  1: 'Lavanda', 2: 'Salvia', 3: 'Vinaccia', 4: 'Fenicottero', 5: 'Banana', 6: 'Mandarino',
  7: 'Pavone', 8: 'Grafite', 9: 'Mirtillo', 10: 'Basilico', 11: 'Pomodoro', default: 'Colore del calendario',
}

// "Rossi Mario via Roma 12" → { name: 'Rossi Mario', address: 'via Roma 12' }
const ADDRESS_WORD = /(^|[\s,–-])(via|viale|v\.le|piazza|p\.zza|p\.za|piazzale|strada|str\.|corso|c\.so|largo|vicolo|loc\.|località|localita|contrada|borgo|lungomare|frazione|fraz\.)(?=[\s.])/i
export const parseEventTitle = (title = '') => {
  const text = String(title).replace(/\s+/g, ' ').trim()
  const match = text.match(ADDRESS_WORD)
  if (!match) return { name: text, address: null }
  const index = match.index + match[1].length
  const name = text.slice(0, index).replace(/[\s,–-]+$/, '').trim()
  const address = text.slice(index).trim()
  return name ? { name, address } : { name: text, address }
}

// Numeri di telefono italiani (cellulari 3xx e fissi 0xx) dentro un testo libero; ignora codici più lunghi.
export const extractPhones = (text = '') => {
  const found = String(text).match(/(?<![\d])(?:\+?39[\s.]?)?(?:3\d{2}|0\d{1,3})(?:[\s./-]?\d){5,8}(?![\d])/g) || []
  return [...new Set(found.map((raw) => raw.replace(/\D/g, '').replace(/^39(?=[03]\d{7,})/, '')).filter((digits) => digits.length >= 8 && digits.length <= 11))]
}

// ——— Formato iCalendar (RFC 5545) per il backup ———
const icsText = (value = '') => String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsDateTime = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsDate = (date) => String(date).replace(/-/g, '')
const icsFold = (line) => {
  // Righe al massimo di 75 byte; le continuazioni iniziano con uno spazio.
  const out = []
  let current = ''
  for (const char of line) {
    if (Buffer.byteLength(current + char) > (out.length ? 74 : 75)) { out.push(current); current = char } else current += char
  }
  out.push(current)
  return out.join('\r\n ')
}
const icsTime = (name, time) => (time?.date ? `${name};VALUE=DATE:${icsDate(time.date)}` : `${name}:${icsDateTime(time?.dateTime)}`)

export const toIcs = (events, calendarId = '') => {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FixLab//Backup Google Calendar//IT', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(`Backup ${calendarId}`)}`]
  for (const event of events) {
    if (!event.start || (!event.start.dateTime && !event.start.date)) continue
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${icsText(event.iCalUID || `${event.id}@google.com`)}`)
    lines.push(`DTSTAMP:${icsDateTime(event.updated || new Date().toISOString())}`)
    lines.push(icsTime('DTSTART', event.start))
    if (event.end) lines.push(icsTime('DTEND', event.end))
    if (event.originalStartTime) lines.push(icsTime('RECURRENCE-ID', event.originalStartTime))
    for (const rule of event.recurrence || []) lines.push(rule)
    lines.push(`SUMMARY:${icsText(event.summary || '')}`)
    if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`)
    if (event.location) lines.push(`LOCATION:${icsText(event.location)}`)
    if (event.colorId) lines.push(`X-GOOGLE-COLOR-ID:${icsText(event.colorId)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(icsFold).join('\r\n')}\r\n`
}

const hashOf = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex')
const isGone = (error) => error instanceof GoogleApiError && [404, 410].includes(error.status)

export const createCalendarSync = ({ db, google, settings, config, logger }) => {
  const gcal = (options) => google.request({ scopes: GOOGLE_SCOPES.calendar, ...options })
  const eventsUrl = (calendarId, suffix = '') => `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${suffix}`

  const getConfig = async () => ({ ...CALENDAR_DEFAULTS, ...((await settings.get(CALENDAR_SETTINGS_KEY)) || {}) })
  const getState = async () => (await settings.get(STATE_KEY)) || {}
  const setState = async (patch) => settings.set(STATE_KEY, { ...(await getState()), ...patch })

  const getLink = (entityType, entityId) => db.one('SELECT * FROM "google_event_links" WHERE "entityType" = $1 AND "entityId" = $2', [entityType, entityId])
  const getLinkByEvent = (calendarId, googleEventId) => db.one('SELECT * FROM "google_event_links" WHERE "calendarId" = $1 AND "googleEventId" = $2', [calendarId, googleEventId])
  // origin: 'google' = evento scritto a mano su Google, 'app' = creato dal gestionale, null = invariato.
  const saveLink = async ({ entityType, entityId, calendarId, event, pushedHash, origin = null }) => {
    await db.query(
      `INSERT INTO "google_event_links" ("id", "entityType", "entityId", "calendarId", "googleEventId", "etag", "htmlLink", "googleUpdatedAt", "pushedHash", "origin", "lastSyncedAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT ("entityType", "entityId") DO UPDATE SET "calendarId" = EXCLUDED."calendarId", "googleEventId" = EXCLUDED."googleEventId",
         "etag" = EXCLUDED."etag", "htmlLink" = EXCLUDED."htmlLink", "googleUpdatedAt" = EXCLUDED."googleUpdatedAt",
         "pushedHash" = EXCLUDED."pushedHash", "origin" = COALESCE("google_event_links"."origin", EXCLUDED."origin"), "lastSyncedAt" = NOW()`,
      [newId(), entityType, entityId, calendarId, event.id, event.etag || null, event.htmlLink || null, event.updated ? new Date(event.updated) : null, pushedHash, origin],
    )
  }
  const removeLink = (id) => db.query('DELETE FROM "google_event_links" WHERE "id" = $1', [id])

  // REGOLA DI SICUREZZA: un evento scritto a mano su Google non viene MAI cancellato dal gestionale.
  // Se la chiamata collegata viene annullata/eliminata, togliamo solo il collegamento.
  const deleteRemote = async (link) => {
    if (link.origin === 'google') {
      await removeLink(link.id)
      return 'unlinked'
    }
    try {
      await gcal({ method: 'DELETE', url: eventsUrl(link.calendarId, `/${encodeURIComponent(link.googleEventId)}`) })
    } catch (error) {
      if (!isGone(error)) throw error
    }
    await removeLink(link.id)
    return 'deleted'
  }

  // ——— App → Google ———

  const operatorColor = (row, cfg) => Object.entries(cfg.colorOperators || {}).find(([color, userId]) => color !== 'default' && userId && userId === row.assignedToId)?.[0]
  const colorsByOperator = (cfg) => Object.values(cfg.colorOperators || {}).some(Boolean)

  const interventionEvent = (row, cfg) => {
    const minutes = Number(row.additionalData?.durationMinutes) || cfg.defaultMinutes
    const start = new Date(row.openedAt)
    const end = new Date(start.getTime() + minutes * 60_000)
    const ownColor = operatorColor(row, cfg)
    if (row.additionalData?.source === 'google') {
      // Evento scritto a mano su Google: titolo e descrizione restano vostri, aggiorniamo solo orario e colore.
      return {
        start: { dateTime: start.toISOString(), timeZone: cfg.timeZone },
        end: { dateTime: end.toISOString(), timeZone: cfg.timeZone },
        ...(ownColor ? { colorId: ownColor } : {}),
        extendedProperties: { private: { fixlabType: 'intervention', fixlabId: row.id, fixlabCode: row.code } },
      }
    }
    const what = row.description || [row.additionalData?.applianceBrand, row.additionalData?.defect].filter(Boolean).join(' ') || ''
    const done = row.status === 'completato'
    const summary = `${done ? '✔ ' : ''}[${TYPE_LABEL[row.type]}] ${row.customerName}${what ? ` — ${what}` : ''}`.slice(0, 200)
    const link = config.PUBLIC_URL ? `${config.PUBLIC_URL}/#/${TYPE_ROUTE[row.type]}?id=${row.id}` : ''
    const description = [
      `Codice: ${row.code}`,
      `Cliente: ${row.customerName}${row.customerPhone ? ` — tel. ${row.customerPhone}` : ''}`,
      `Stato: ${STATUS_LABEL[row.status] || row.status} · Urgenza: ${URGENCY_LABEL[row.priority] || row.priority}`,
      row.operatorEmail ? `Assegnato a: ${row.operatorEmail.split('@')[0]}` : null,
      row.additionalData?.applianceBrand || row.additionalData?.applianceModel ? `Apparecchio: ${[row.additionalData.applianceBrand, row.additionalData.applianceModel].filter(Boolean).join(' ')}` : null,
      row.description ? `\n${row.description}` : null,
      link ? `\nApri nel gestionale: ${link}` : null,
    ].filter(Boolean).join('\n')
    return {
      summary,
      description,
      location: row.customerAddress || undefined,
      start: { dateTime: start.toISOString(), timeZone: cfg.timeZone },
      end: { dateTime: end.toISOString(), timeZone: cfg.timeZone },
      // Se i colori indicano i tecnici usiamo il colore del tecnico assegnato, altrimenti colore per tipo/stato.
      ...(colorsByOperator(cfg)
        ? (ownColor ? { colorId: ownColor } : {})
        : { colorId: done ? '8' : (row.priority === 3 ? '11' : TYPE_COLOR[row.type]) }),
      extendedProperties: { private: { fixlabType: 'intervention', fixlabId: row.id, fixlabCode: row.code } },
    }
  }

  const calendarItemEvent = (item, cfg) => (item.allDay
    ? {
      summary: item.title,
      description: item.description || undefined,
      location: item.location || undefined,
      start: { date: new Date(item.startAt).toISOString().slice(0, 10) },
      end: { date: new Date(item.endAt).toISOString().slice(0, 10) },
      extendedProperties: { private: { fixlabType: 'calendar_item', fixlabId: item.id } },
    }
    : {
      summary: item.title,
      description: item.description || undefined,
      location: item.location || undefined,
      start: { dateTime: new Date(item.startAt).toISOString(), timeZone: cfg.timeZone },
      end: { dateTime: new Date(item.endAt).toISOString(), timeZone: cfg.timeZone },
      extendedProperties: { private: { fixlabType: 'calendar_item', fixlabId: item.id } },
    })

  const upsertRemote = async ({ entityType, entityId, body, link, cfg }) => {
    const hash = hashOf(body)
    if (link?.pushedHash === DELETED_IN_GOOGLE) return 'skipped_deleted_in_google'
    // Gli eventi scritti a mano su Google restano nel loro calendario: non li spostiamo né li ricreiamo altrove.
    if (link?.origin === 'google' && link.calendarId !== cfg.calendarId) return 'kept'
    if (link && link.calendarId !== cfg.calendarId) { await deleteRemote(link); link = null }
    if (link && link.pushedHash === hash) return 'unchanged'
    let event = null
    if (link) {
      try {
        event = await gcal({ method: 'PATCH', url: eventsUrl(link.calendarId, `/${encodeURIComponent(link.googleEventId)}`), body })
      } catch (error) {
        if (!isGone(error)) throw error
        event = null // evento eliminato su Google nel frattempo: lo ricreiamo
      }
    }
    if (!event) event = await gcal({ method: 'POST', url: eventsUrl(cfg.calendarId), body })
    await saveLink({ entityType, entityId, calendarId: cfg.calendarId, event, pushedHash: hash, origin: link ? null : 'app' })
    return link ? 'updated' : 'created'
  }

  const loadIntervention = (id) => db.one(
    `SELECT i.*, c."name" AS "customerName", c."phone" AS "customerPhone", c."address" AS "customerAddress", u."email" AS "operatorEmail"
     FROM "interventions" i JOIN "customers" c ON c."id" = i."customerId" LEFT JOIN "users" u ON u."id" = i."assignedToId"
     WHERE i."id" = $1`,
    [id],
  )

  const pushIntervention = async (id, cfg) => {
    const row = await loadIntervention(id)
    const link = await getLink('intervention', id)
    const isNewEnough = !cfg.pushSince || new Date(row?.createdAt) >= new Date(cfg.pushSince)
    const wanted = row && cfg.pushTypes.includes(row.type) && row.status !== 'annullato' && (link || isNewEnough)
    if (!wanted) {
      if (link && link.pushedHash !== DELETED_IN_GOOGLE) return deleteRemote(link)
      return 'ignored'
    }
    // Una chiamata nata su Google senza più collegamento non va ricreata (avrebbe solo l'orario, senza titolo).
    if (row.additionalData?.source === 'google' && !link) return 'ignored'
    return upsertRemote({ entityType: 'intervention', entityId: id, body: interventionEvent(row, cfg), link, cfg })
  }

  const pushCalendarItem = async (id, cfg) => {
    const item = await db.one('SELECT * FROM "calendar_items" WHERE "id" = $1', [id])
    const link = await getLink('calendar_item', id)
    if (!item) {
      if (link) return deleteRemote(link)
      return 'ignored'
    }
    if (item.interventionId) return 'ignored' // l'appuntamento viaggia già con l'intervento
    if (item.source === 'google' && !link) return 'ignored'
    return upsertRemote({ entityType: 'calendar_item', entityId: id, body: calendarItemEvent(item, cfg), link, cfg })
  }

  // ——— Google → App ———

  const eventTimes = (event, cfg) => {
    if (event.start?.dateTime) {
      const start = new Date(event.start.dateTime)
      const end = event.end?.dateTime ? new Date(event.end.dateTime) : new Date(start.getTime() + cfg.defaultMinutes * 60_000)
      return { start, end, allDay: false }
    }
    if (event.start?.date) {
      // Evento di un giorno intero: la data di fine in Google è esclusiva.
      return { start: new Date(`${event.start.date}T00:00:00.000Z`), end: new Date(`${(event.end?.date || event.start.date)}T00:00:00.000Z`), allDay: true }
    }
    return null
  }

  // undefined = nessun abbinamento configurato per quel colore (non tocchiamo l'assegnazione)
  const operatorFromColor = (event, cfg) => {
    const userId = (cfg.colorOperators || {})[event.colorId || 'default']
    return userId || undefined
  }

  // Evento creato a mano su Google → nuova chiamata. Il cliente si riconosce dal telefono,
  // altrimenti da nome + indirizzo, altrimenti viene creato.
  const looksLikeCall = (event) => Boolean(extractPhones(`${event.summary || ''} ${event.description || ''}`).length || parseEventTitle(event.summary).address)

  const importCall = async (event, cfg, report) => {
    const times = eventTimes(event, cfg)
    const { name, address } = parseEventTitle(event.summary || '(senza titolo)')
    const phones = extractPhones(`${event.summary || ''}\n${event.description || ''}`)
    const operatorId = operatorFromColor(event, cfg) || null
    const id = await db.tx(async (client) => {
      let customer = null
      for (const phone of phones) {
        customer = await client.one(
          `SELECT * FROM "customers" WHERE regexp_replace(coalesce("phone", ''), '\\D', '', 'g') LIKE '%' || $1 || '%' ORDER BY "createdAt" LIMIT 1`,
          [phone],
        )
        if (customer) break
      }
      if (!customer) {
        customer = await client.one(
          `SELECT * FROM "customers" WHERE lower("name") = lower($1) AND lower(coalesce("address", '')) = lower(coalesce($2, '')) LIMIT 1`,
          [name, address || event.location || null],
        )
      }
      if (!customer) {
        customer = await client.one(
          `INSERT INTO "customers" ("id", "name", "phone", "address", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
          [newId(), name.slice(0, 200), phones.join(' / ') || null, address || event.location || null],
        )
        report.createdCustomers = (report.createdCustomers || 0) + 1
      }
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const status = /^\s*annul/i.test(event.summary || '') ? 'annullato' : (times.start < startOfToday ? 'completato' : 'pendente')
      const interventionId = newId()
      const code = `INV-${times.start.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')}`
      await client.query(
        `INSERT INTO "interventions" ("id", "code", "customerId", "type", "status", "priority", "assignedToId", "description", "openedAt", "closedAt",
           "additionalData", "version", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'chiamata', $4, 2, $5, $6, $7, $8, $9, 1, NOW(), NOW())`,
        [interventionId, code, customer.id, status, operatorId, event.description || null, times.start, status === 'pendente' ? null : times.end,
          { source: 'google', googleTitle: event.summary || '', googleColorId: event.colorId || null, durationMinutes: Math.max(5, Math.round((times.end - times.start) / 60_000)) }],
      )
      await client.query(
        'INSERT INTO "intervento_logs" ("id", "interventoId", "userId", "action", "note", "createdAt") VALUES ($1, $2, NULL, $3, $4, NOW())',
        [newId(), interventionId, 'importato_da_google', event.summary || ''],
      )
      return interventionId
    })
    report.importedCalls = (report.importedCalls || 0) + 1
    const fresh = await loadIntervention(id)
    await saveLink({ entityType: 'intervention', entityId: id, calendarId: cfg.calendarId, event, pushedHash: hashOf(interventionEvent(fresh, cfg)), origin: 'google' })
  }

  const applyIntervention = async (event, link, cfg, report) => {
    const id = link?.entityId || event.extendedProperties?.private?.fixlabId
    const row = id ? await loadIntervention(id) : null
    if (!row) return
    const times = eventTimes(event, cfg)
    if (times && !times.allDay) {
      const minutes = Math.max(5, Math.round((times.end - times.start) / 60_000))
      const currentMinutes = Number(row.additionalData?.durationMinutes) || cfg.defaultMinutes
      if (times.start.getTime() !== new Date(row.openedAt).getTime() || minutes !== currentMinutes) {
        await db.tx(async (client) => {
          await client.query(
            `UPDATE "interventions" SET "openedAt" = $2, "additionalData" = coalesce("additionalData", '{}'::jsonb) || jsonb_build_object('durationMinutes', $3::int),
               "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = $1`,
            [row.id, times.start, minutes],
          )
          await client.query(
            'INSERT INTO "intervento_logs" ("id", "interventoId", "userId", "action", "note", "createdAt") VALUES ($1, $2, NULL, $3, $4, NOW())',
            [newId(), row.id, 'spostato_da_google', `Appuntamento spostato in Google Calendar: ${times.start.toISOString()}`],
          )
        })
        report.movedInterventions += 1
      }
    }
    if (row.additionalData?.source === 'google') {
      const operatorId = operatorFromColor(event, cfg)
      const description = event.description || null
      const title = event.summary || ''
      const colorId = event.colorId || null
      const colorChanged = !('googleColorId' in (row.additionalData || {})) || row.additionalData.googleColorId !== colorId
      if (description !== row.description || title !== row.additionalData?.googleTitle || colorChanged || (operatorId !== undefined && operatorId !== row.assignedToId)) {
        await db.query(
          `UPDATE "interventions" SET "description" = $2,
             "additionalData" = coalesce("additionalData", '{}'::jsonb) || jsonb_build_object('googleTitle', $3::text, 'googleColorId', $6::text),
             "assignedToId" = CASE WHEN $4::boolean THEN $5 ELSE "assignedToId" END, "version" = "version" + 1, "updatedAt" = NOW() WHERE "id" = $1`,
          [row.id, description, title, operatorId !== undefined, operatorId ?? null, colorId],
        )
        report.updatedInterventions = (report.updatedInterventions || 0) + 1
      }
    }
    // Ricalcoliamo l'hash sullo stato aggiornato: così il prossimo push non riscrive l'evento inutilmente.
    const fresh = await loadIntervention(row.id)
    await saveLink({ entityType: 'intervention', entityId: row.id, calendarId: cfg.calendarId, event, pushedHash: hashOf(interventionEvent(fresh, cfg)) })
  }

  const applyCalendarItem = async (event, link, cfg, report) => {
    const times = eventTimes(event, cfg)
    if (!times) return
    const fields = [event.summary || '(senza titolo)', event.description || null, times.start, times.end, times.allDay, event.location || null, event.colorId || null]
    let itemId = link?.entityId || (event.extendedProperties?.private?.fixlabType === 'calendar_item' ? event.extendedProperties.private.fixlabId : null)
    const existing = itemId ? await db.one('SELECT "id" FROM "calendar_items" WHERE "id" = $1', [itemId]) : null
    if (existing) {
      await db.query(
        `UPDATE "calendar_items" SET "title" = $2, "description" = $3, "startAt" = $4, "endAt" = $5, "allDay" = $6, "location" = $7, "colorId" = $8, "updatedAt" = NOW() WHERE "id" = $1`,
        [itemId, ...fields],
      )
      report.updatedEvents += 1
    } else {
      if (!cfg.importEvents) return
      itemId = newId()
      await db.query(
        `INSERT INTO "calendar_items" ("id", "title", "description", "startAt", "endAt", "allDay", "location", "colorId", "status", "source", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'planned', 'google', NOW(), NOW())`,
        [itemId, ...fields],
      )
      report.importedEvents += 1
    }
    const item = await db.one('SELECT * FROM "calendar_items" WHERE "id" = $1', [itemId])
    await saveLink({ entityType: 'calendar_item', entityId: itemId, calendarId: cfg.calendarId, event, pushedHash: hashOf(calendarItemEvent(item, cfg)), origin: item.source === 'google' ? 'google' : null })
  }

  const processEvent = async (event, cfg, report, { force = false } = {}) => {
    const link = await getLinkByEvent(cfg.calendarId, event.id)
    const isOurs = event.extendedProperties?.private?.fixlabType
    if (event.status === 'cancelled') {
      if (!link) return
      if (link.entityType === 'calendar_item') {
        await db.query('DELETE FROM "calendar_items" WHERE "id" = $1', [link.entityId])
        await removeLink(link.id)
        report.deletedEvents += 1
      } else {
        // Evento di un intervento cancellato a mano in Google: rispettiamo la scelta e non lo ricreiamo.
        await db.query('UPDATE "google_event_links" SET "pushedHash" = $2, "lastSyncedAt" = NOW() WHERE "id" = $1', [link.id, DELETED_IN_GOOGLE])
        report.detached += 1
      }
      return
    }
    if (!force && link && link.etag && link.etag === event.etag) return // è l'eco di una nostra scrittura
    if ((link?.entityType || isOurs) === 'intervention') return applyIntervention(event, link, cfg, report)
    if (!link && !isOurs && cfg.importAsCalls && event.start?.dateTime && looksLikeCall(event)) return importCall(event, cfg, report)
    return applyCalendarItem(event, link, cfg, report)
  }

  // force: rilegge tutti gli eventi (anche quelli già allineati), es. per recuperare i colori.
  const pull = async (cfg, { force = false } = {}) => {
    const report = { movedInterventions: 0, importedEvents: 0, updatedEvents: 0, deletedEvents: 0, detached: 0, pages: 0 }
    const state = await getState()
    let syncToken = !force && state.calendarId === cfg.calendarId ? state.syncToken : null
    let pageToken = null
    for (let guard = 0; guard < 200; guard += 1) {
      const params = new URLSearchParams({ singleEvents: 'true', maxResults: '250' })
      if (pageToken) params.set('pageToken', pageToken)
      if (syncToken) params.set('syncToken', syncToken)
      else {
        params.set('timeMin', new Date(Date.now() - 30 * 86_400_000).toISOString())
        params.set('showDeleted', 'true')
      }
      let page
      try {
        page = await gcal({ url: `${eventsUrl(cfg.calendarId)}?${params}` })
      } catch (error) {
        if (error instanceof GoogleApiError && error.status === 410 && syncToken) {
          // Token scaduto: Google chiede una sincronizzazione completa.
          syncToken = null
          pageToken = null
          continue
        }
        throw error
      }
      report.pages += 1
      for (const event of page.items || []) {
        try {
          await processEvent(event, cfg, report, { force })
        } catch (error) {
          logger.warn('calendar_event_failed', { eventId: event.id, error: error.message })
        }
      }
      if (page.nextPageToken) { pageToken = page.nextPageToken; continue }
      await setState({ syncToken: page.nextSyncToken || null, calendarId: cfg.calendarId })
      break
    }
    return report
  }

  // ——— Coda delle modifiche locali (debounce) e sincronizzazione periodica ———

  // Tutte le operazioni verso Google passano da qui una alla volta: due sincronizzazioni in parallelo
  // (es. quella automatica all'attivazione e una manuale) altrimenti creerebbero eventi doppi.
  let chain = Promise.resolve()
  const exclusive = (fn) => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }

  const queue = new Map()
  let flushTimer = null
  let running = null

  const flush = () => exclusive(async () => {
    flushTimer = null
    const cfg = await getConfig()
    if (!cfg.enabled || cfg.readOnly || (await google.getMode()) === 'none') { queue.clear(); return }
    const items = [...queue.values()]
    queue.clear()
    for (const { entityType, id } of items) {
      try {
        if (entityType === 'intervention') await pushIntervention(id, cfg)
        else await pushCalendarItem(id, cfg)
      } catch (error) {
        logger.warn('calendar_push_failed', { entityType, id, error: error.message })
        await setState({ lastError: error.message, lastErrorAt: new Date().toISOString() })
      }
    }
  })

  const enqueue = (entityType, id, delayMs = 1500) => {
    queue.set(`${entityType}:${id}`, { entityType, id })
    if (!flushTimer) flushTimer = setTimeout(() => { running = flush().finally(() => { running = null }) }, delayMs)
    flushTimer.unref?.()
  }

  // Sincronizzazione completa: carica su Google gli interventi (da 30 giorni fa in poi) e poi legge le modifiche.
  const syncNow = ({ recreateDeleted = false } = {}) => exclusive(async () => {
    const cfg = await getConfig()
    if (!cfg.enabled) return { skipped: 'disabled' }
    if ((await google.getMode()) === 'none') return { skipped: 'not_connected' }
    const report = { pushed: { created: 0, updated: 0, unchanged: 0, deleted: 0, unlinked: 0, kept: 0, ignored: 0, skipped_deleted_in_google: 0, read_only: 0 }, pulled: null, errors: [] }
    try {
      if (recreateDeleted) await db.query('DELETE FROM "google_event_links" WHERE "pushedHash" = $1', [DELETED_IN_GOOGLE])
      const interventions = await db.query(
        `SELECT "id" FROM "interventions" WHERE "openedAt" >= NOW() - interval '30 days'
         UNION SELECT "entityId" FROM "google_event_links" WHERE "entityType" = 'intervention'`,
      )
      const items = await db.query(`SELECT "id" FROM "calendar_items" WHERE "source" = 'app' AND "endAt" >= NOW() - interval '30 days'`)
      if (cfg.readOnly) {
        report.pushed.read_only = interventions.length + items.length
      } else {
        for (const { id } of interventions) {
          try { report.pushed[await pushIntervention(id, cfg)] += 1 } catch (error) { report.errors.push(error.message) }
        }
        for (const { id } of items) {
          try { report.pushed[await pushCalendarItem(id, cfg)] += 1 } catch (error) { report.errors.push(error.message) }
        }
      }
      // Una volta sola: rilettura completa per recuperare i colori degli eventi già importati.
      const stateNow = await getState()
      report.pulled = await pull(cfg, { force: !stateNow.colorsBackfilled })
      await refreshCalendarColor(cfg)
      await setState({ colorsBackfilled: true, lastSyncAt: new Date().toISOString(), lastReport: report, lastError: report.errors[0] || null })
    } catch (error) {
      await setState({ lastError: error.message, lastErrorAt: new Date().toISOString() })
      throw error
    }
    return report
  })

  const pullNow = () => exclusive(async () => {
    const cfg = await getConfig()
    if (!cfg.enabled || (await google.getMode()) === 'none') return null
    try {
      const report = await pull(cfg)
      await setState({ lastPullAt: new Date().toISOString(), lastError: null })
      return report
    } catch (error) {
      await setState({ lastError: error.message, lastErrorAt: new Date().toISOString() })
      logger.warn('calendar_pull_failed', { error: error.message })
      return null
    }
  })

  const status = async () => {
    const [cfg, state, counts] = await Promise.all([
      getConfig(),
      getState(),
      db.one(`SELECT COUNT(*) FILTER (WHERE "entityType" = 'intervention' AND coalesce("pushedHash",'') <> $1)::int AS "interventions",
                     COUNT(*) FILTER (WHERE "entityType" = 'calendar_item')::int AS "events",
                     COUNT(*) FILTER (WHERE "pushedHash" = $1)::int AS "deletedInGoogle" FROM "google_event_links"`, [DELETED_IN_GOOGLE]),
    ])
    const { syncToken, ...publicState } = state
    return { settings: cfg, state: { ...publicState, hasSyncToken: Boolean(syncToken) }, links: counts }
  }

  const updateSettings = async (patch) => {
    const current = await getConfig()
    const next = { ...current }
    if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled)
    if (next.enabled && !current.enabled && !current.pushSince) next.pushSince = patch.pushExisting ? null : new Date().toISOString()
    if (patch.pushExisting === true) next.pushSince = null
    if (typeof patch.calendarId === 'string' && patch.calendarId.trim()) next.calendarId = patch.calendarId.trim()
    if (Array.isArray(patch.pushTypes)) next.pushTypes = patch.pushTypes.filter((type) => TYPE_LABEL[type])
    if (patch.importEvents !== undefined) next.importEvents = Boolean(patch.importEvents)
    if (patch.importAsCalls !== undefined) next.importAsCalls = Boolean(patch.importAsCalls)
    if (patch.readOnly !== undefined) next.readOnly = Boolean(patch.readOnly)
    if (patch.colorOperators && typeof patch.colorOperators === 'object') {
      next.colorOperators = Object.fromEntries(Object.entries(patch.colorOperators)
        .filter(([color, userId]) => GOOGLE_EVENT_COLORS[color] && typeof userId === 'string' && userId))
    }
    const minutes = Number(patch.defaultMinutes)
    if (Number.isFinite(minutes) && minutes >= 5 && minutes <= 600) next.defaultMinutes = Math.round(minutes)
    await settings.set(CALENDAR_SETTINGS_KEY, next)
    if (next.calendarId !== current.calendarId) await setState({ syncToken: null })
    return next
  }

  // ——— Backup del calendario Google: tutti gli eventi in formato .ics (reimportabile in Google
  // Calendar da Impostazioni → Importa) più una copia JSON completa (colori, proprietà, ID). ———
  const exportCalendar = async (calendarId) => {
    const events = []
    let pageToken = null
    for (let guard = 0; guard < 400; guard += 1) {
      const params = new URLSearchParams({ maxResults: '2500', singleEvents: 'false', showDeleted: 'false' })
      if (pageToken) params.set('pageToken', pageToken)
      const page = await gcal({ url: `${eventsUrl(calendarId)}?${params}` })
      events.push(...(page.items || []).filter((event) => event.status !== 'cancelled'))
      if (!page.nextPageToken) break
      pageToken = page.nextPageToken
    }
    return { events, ics: toIcs(events, calendarId) }
  }

  // Colore del calendario (usato dagli eventi senza un colore proprio).
  const refreshCalendarColor = async (cfg) => {
    try {
      const entry = await gcal({ url: `/calendar/v3/users/me/calendarList/${encodeURIComponent(cfg.calendarId)}` })
      if (entry?.backgroundColor) await setState({ calendarColor: entry.backgroundColor })
    } catch { /* non indispensabile */ }
  }

  const colors = async () => {
    const [cfg, state] = await Promise.all([getConfig(), getState()])
    return { enabled: cfg.enabled, calendarColor: state.calendarColor || null, colorOperators: cfg.colorOperators || {} }
  }

  const htmlLinkFor = async (entityType, entityId) => (await getLink(entityType, entityId))?.htmlLink || null

  let timers = []
  const start = () => {
    const minutes = Math.max(1, Number(process.env.CALENDAR_SYNC_INTERVAL_MINUTES || 5))
    timers.push(setInterval(() => { pullNow() }, minutes * 60_000))
    // Ogni 6 ore un giro completo per recuperare eventuali modifiche perse (es. server riavviato a metà).
    timers.push(setInterval(() => { syncNow().catch((error) => logger.warn('calendar_full_sync_failed', { error: error.message })) }, 6 * 3600_000))
    timers.push(setTimeout(() => { syncNow().catch(() => {}) }, 90_000))
    timers.forEach((t) => t.unref?.())
  }
  const stop = () => {
    timers.forEach((t) => { clearInterval(t); clearTimeout(t) })
    timers = []
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
  }
  const idle = async () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; running = flush() }
    await running
    await chain
  }

  return { enqueue, syncNow, pullNow, status, updateSettings, getConfig, htmlLinkFor, exportCalendar, colors, start, stop, idle, interventionEvent }
}
