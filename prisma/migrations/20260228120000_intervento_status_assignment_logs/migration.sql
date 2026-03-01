CREATE TYPE "InterventionStatus_new" AS ENUM ('pendente', 'in_lavorazione', 'completato', 'annullato');

ALTER TABLE "interventions"
  ALTER COLUMN "status" TYPE "InterventionStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'pendente' THEN 'pendente'::"InterventionStatus_new"
      WHEN "status"::text IN ('preso_in_carico', 'ordine_ricambi', 'preventivato') THEN 'in_lavorazione'::"InterventionStatus_new"
      WHEN "status"::text IN ('diagnosticato', 'saldato', 'chiuso') THEN 'completato'::"InterventionStatus_new"
      ELSE 'annullato'::"InterventionStatus_new"
    END
  );

DROP TYPE "InterventionStatus";
ALTER TYPE "InterventionStatus_new" RENAME TO "InterventionStatus";

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

ALTER TABLE "interventions" ADD CONSTRAINT "interventions_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intervento_logs" ADD CONSTRAINT "intervento_logs_interventoId_fkey" FOREIGN KEY ("interventoId") REFERENCES "interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intervento_logs" ADD CONSTRAINT "intervento_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
