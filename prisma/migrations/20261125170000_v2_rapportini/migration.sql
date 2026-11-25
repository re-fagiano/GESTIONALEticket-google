-- Numerazione progressiva dei rapportini d'intervento, per anno (R-2026-0001, R-2026-0002, …).
CREATE TABLE IF NOT EXISTS "report_counters" (
  "year" INTEGER NOT NULL,
  "last" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "report_counters_pkey" PRIMARY KEY ("year")
);
