CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "city" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "InterventionType" AS ENUM ('CALL_OUT', 'LAB_REPAIR', 'SPARE_PART_ORDER', 'NEW_APPLIANCE_QUOTE');
CREATE TYPE "InterventionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'WAITING_CUSTOMER', 'DONE', 'CANCELED');

CREATE TABLE "interventions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" "InterventionType" NOT NULL,
  "status" "InterventionStatus" NOT NULL DEFAULT 'OPEN',
  "urgency" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT,
  "description" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "assignedTo" TEXT,
  "additionalData" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "customerId" TEXT NOT NULL,
  CONSTRAINT "interventions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notes" (
  "id" TEXT NOT NULL,
  "interventionId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_items" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "status" TEXT DEFAULT 'planned',
  "customerId" TEXT,
  "interventionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calendar_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tickets" (
  "id" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'aperto',
  "date" TEXT,
  "time" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "customerId" TEXT,
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "location" TEXT,
  "qty" INTEGER NOT NULL DEFAULT 0,
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minQty" INTEGER NOT NULL DEFAULT 0,
  "priceDate" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "interventions_code_key" ON "interventions"("code");
CREATE INDEX "customers_name_idx" ON "customers"("name");
CREATE INDEX "interventions_customerId_idx" ON "interventions"("customerId");
CREATE INDEX "interventions_status_idx" ON "interventions"("status");
CREATE INDEX "calendar_items_startAt_endAt_idx" ON "calendar_items"("startAt", "endAt");
CREATE INDEX "tickets_customerId_idx" ON "tickets"("customerId");
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

ALTER TABLE "interventions" ADD CONSTRAINT "interventions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calendar_items" ADD CONSTRAINT "calendar_items_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
