-- FixLab v2 — migrazione SOLO ADDITIVA: nessuna colonna o tabella esistente viene rimossa o modificata.
-- I vincoli su dati esistenti non bloccano mai il deploy: se ci sono righe orfane viene solo emesso un NOTICE.
-- Tutte le istruzioni sono idempotenti (IF NOT EXISTS) così la migrazione è sicura anche su database
-- che hanno uno storico di migrazioni parziale.

-- 1) Movimenti di magazzino: ogni variazione di quantità lascia una traccia.
CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "qtyAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'rettifica',
  "note" TEXT,
  "interventionId" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "inventory_movements_itemId_createdAt_idx" ON "inventory_movements"("itemId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_movements_interventionId_idx" ON "inventory_movements"("interventionId");

DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN RAISE NOTICE 'Vincolo non aggiunto: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_interventionId_fkey"
    FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN RAISE NOTICE 'Vincolo non aggiunto: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN RAISE NOTICE 'Vincolo non aggiunto: %', SQLERRM;
END $$;

-- 2) Indici di ricerca magazzino.
CREATE INDEX IF NOT EXISTS "inventory_code_idx" ON "inventory"("code");
CREATE INDEX IF NOT EXISTS "inventory_name_idx" ON "inventory"("name");

-- 3) Rate limit condiviso (prima veniva creato a runtime dal server).
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "reset_at" TIMESTAMP NOT NULL,
  "updated_at" TIMESTAMP NOT NULL,
  PRIMARY KEY ("scope", "key")
);

-- 4) Vincoli che in alcuni database potrebbero mancare (migrazione 20260228 eseguita prima della tabella users).
DO $$ BEGIN
  ALTER TABLE "interventions" ADD CONSTRAINT "interventions_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN RAISE NOTICE 'Vincolo non aggiunto: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE "intervento_logs" ADD CONSTRAINT "intervento_logs_interventoId_fkey"
    FOREIGN KEY ("interventoId") REFERENCES "interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN RAISE NOTICE 'Vincolo non aggiunto: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE "intervento_logs" ADD CONSTRAINT "intervento_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN RAISE NOTICE 'Vincolo non aggiunto: %', SQLERRM;
END $$;

-- 5) Impostazioni dell'applicazione (es. collegamento Google, stato sincronizzazione calendario).
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" TEXT NOT NULL,
  "value" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
