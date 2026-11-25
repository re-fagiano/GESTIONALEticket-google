-- Protezione del Google Calendar: ricordiamo chi ha creato ogni evento collegato.
-- 'google' = scritto a mano su Google (il gestionale non lo cancella né lo sposta mai di calendario),
-- 'app' = creato dal gestionale. Migrazione additiva e idempotente.
ALTER TABLE "google_event_links" ADD COLUMN IF NOT EXISTS "origin" TEXT;

UPDATE "google_event_links" l SET "origin" = 'google'
WHERE l."origin" IS NULL AND (
  (l."entityType" = 'intervention' AND EXISTS (SELECT 1 FROM "interventions" i WHERE i."id" = l."entityId" AND i."additionalData"->>'source' = 'google'))
  OR (l."entityType" = 'calendar_item' AND EXISTS (SELECT 1 FROM "calendar_items" c WHERE c."id" = l."entityId" AND c."source" = 'google'))
);
UPDATE "google_event_links" SET "origin" = 'app' WHERE "origin" IS NULL;
