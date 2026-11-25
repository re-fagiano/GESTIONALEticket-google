-- File (foto, documenti, firme, PDF) salvati come binari in una tabella dedicata, invece che
-- in base64 dentro il JSON degli interventi (che rallentava ogni elenco). Migrazione additiva.
CREATE TABLE IF NOT EXISTS "files" (
  "id" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'attachment',
  "interventionId" TEXT,
  "uploadedBy" TEXT,
  "driveFileId" TEXT,
  "backedUpAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "files_interventionId_idx" ON "files"("interventionId");
CREATE INDEX IF NOT EXISTS "files_backedUpAt_idx" ON "files"("backedUpAt");
