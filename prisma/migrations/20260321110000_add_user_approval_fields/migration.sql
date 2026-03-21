ALTER TABLE "users"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users"
SET "status" = 'active',
    "approved" = true;
