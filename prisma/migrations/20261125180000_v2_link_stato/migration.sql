-- Link pubblici di stato per i clienti (/s/<token>): uno per intervento, revocabile.
CREATE TABLE IF NOT EXISTS "public_links" (
  "token" TEXT NOT NULL,
  "interventionId" TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "views" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  CONSTRAINT "public_links_pkey" PRIMARY KEY ("token")
);
CREATE INDEX IF NOT EXISTS "public_links_interventionId_idx" ON "public_links"("interventionId");
DO $$ BEGIN
  ALTER TABLE "public_links" ADD CONSTRAINT "public_links_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'public_links_interventionId_fkey esiste già';
END $$;
