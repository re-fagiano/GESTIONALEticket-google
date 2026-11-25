-- FixLab v2 — ponte Google Calendar. Migrazione SOLO ADDITIVA e idempotente.

-- Collegamento tra un elemento del gestionale (intervento o evento di calendario) e l'evento Google.
CREATE TABLE IF NOT EXISTS "google_event_links" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL,
  "googleEventId" TEXT NOT NULL,
  "etag" TEXT,
  "htmlLink" TEXT,
  "googleUpdatedAt" TIMESTAMP(3),
  "pushedHash" TEXT,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_event_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "google_event_links_entity_key" ON "google_event_links"("entityType", "entityId");
CREATE UNIQUE INDEX IF NOT EXISTS "google_event_links_event_key" ON "google_event_links"("calendarId", "googleEventId");

-- Eventi di calendario importati da Google o creati nel gestionale.
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'app';
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "allDay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "location" TEXT;
