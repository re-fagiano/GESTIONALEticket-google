DO $$
DECLARE
  user_role_oid oid;
BEGIN
  SELECT t.oid
  INTO user_role_oid
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE t.typname = 'UserRole'
    AND n.nspname = current_schema()
  LIMIT 1;

  IF user_role_oid IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = user_role_oid
        AND enumlabel = 'READER'
    ) THEN
      ALTER TYPE "UserRole" RENAME VALUE 'READER' TO 'VIEWER';
    END IF;
  END IF;
END $$;
