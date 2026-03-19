DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
    IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'UserRole'::regtype AND enumlabel = 'READER') THEN
      ALTER TYPE "UserRole" RENAME VALUE 'READER' TO 'VIEWER';
    END IF;
  END IF;
END $$;
