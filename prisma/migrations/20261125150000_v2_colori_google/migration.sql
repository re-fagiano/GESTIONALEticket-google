-- Colore dell'evento Google (id 1–11) per mostrare nel gestionale gli stessi colori di Google Calendar.
ALTER TABLE "calendar_items" ADD COLUMN IF NOT EXISTS "colorId" TEXT;
