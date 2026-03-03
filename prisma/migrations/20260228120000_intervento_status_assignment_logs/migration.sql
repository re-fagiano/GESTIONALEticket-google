DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'InterventionStatus_new' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "InterventionStatus_new" AS ENUM ('pendente', 'in_lavorazione', 'completato', 'annullato');
  END IF;
END $$;

-- Drop the default first, otherwise Postgres cannot cast it
ALTER TABLE "interventions" ALTER COLUMN "status" DROP DEFAULT;

-- Map old values to new enum
ALTER TABLE "interventions"
  ALTER COLUMN "status" TYPE "InterventionStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'pendente' THEN 'pendente'::"InterventionStatus_new"
      WHEN "status"::text IN ('preso_in_carico', 'ordine_ricambi', 'preventivato', 'in_lavorazione') THEN 'in_lavorazione'::"InterventionStatus_new"
      WHEN "status"::text IN ('diagnosticato', 'saldato', 'chiuso', 'completato') THEN 'completato'::"InterventionStatus_new"
      ELSE 'annullato'::"InterventionStatus_new"
    END
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'InterventionStatus' AND n.nspname = 'public'
  ) THEN
    DROP TYPE "InterventionStatus";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'InterventionStatus_new' AND n.nspname = 'public'
  )
     AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'InterventionStatus' AND n.nspname = 'public'
  ) THEN
    ALTER TYPE "InterventionStatus_new" RENAME TO "InterventionStatus";
  END IF;
END $$;

ALTER TABLE "interventions" ALTER COLUMN "status" SET DEFAULT 'pendente';

ALTER TABLE "interventions" ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;

CREATE TABLE IF NOT EXISTS "intervento_logs" (
  "id" TEXT NOT NULL,
  "interventoId" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intervento_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "intervento_logs_interventoId_createdAt_idx" ON "intervento_logs"("interventoId", "createdAt");
CREATE INDEX IF NOT EXISTS "interventions_assignedToId_idx" ON "interventions"("assignedToId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'interventions_assignedToId_fkey'
      AND r.relname = 'interventions'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "interventions"
      ADD CONSTRAINT "interventions_assignedToId_fkey"
      FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'intervento_logs_interventoId_fkey'
      AND r.relname = 'intervento_logs'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "intervento_logs"
      ADD CONSTRAINT "intervento_logs_interventoId_fkey"
      FOREIGN KEY ("interventoId") REFERENCES "interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'intervento_logs_userId_fkey'
      AND r.relname = 'intervento_logs'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE "intervento_logs"
      ADD CONSTRAINT "intervento_logs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
