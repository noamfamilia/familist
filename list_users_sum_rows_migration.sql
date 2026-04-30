-- list_users: single sum_scope (none | all | active | archived) replaces sum_all / sum_active / sum_archived.
-- Default 'none' (sum row hidden); migrated rows from legacy booleans map to none unless a sum was enabled.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'list_users' AND column_name = 'sum_all'
  ) THEN
    ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS sum_scope text;
    UPDATE public.list_users SET sum_scope =
      CASE
        WHEN sum_all IS TRUE THEN 'all'
        WHEN sum_active IS TRUE THEN 'active'
        WHEN sum_archived IS TRUE THEN 'archived'
        ELSE 'none'
      END;
    ALTER TABLE public.list_users DROP COLUMN sum_all;
    ALTER TABLE public.list_users DROP COLUMN sum_active;
    ALTER TABLE public.list_users DROP COLUMN sum_archived;
    ALTER TABLE public.list_users ALTER COLUMN sum_scope SET NOT NULL;
    ALTER TABLE public.list_users ALTER COLUMN sum_scope SET DEFAULT 'none';
    ALTER TABLE public.list_users DROP CONSTRAINT IF EXISTS list_users_sum_scope_check;
    ALTER TABLE public.list_users ADD CONSTRAINT list_users_sum_scope_check
      CHECK (sum_scope IN ('none', 'all', 'active', 'archived'));
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'list_users' AND column_name = 'sum_scope'
  ) THEN
    ALTER TABLE public.list_users ADD COLUMN sum_scope text NOT NULL DEFAULT 'none'
      CHECK (sum_scope IN ('none', 'all', 'active', 'archived'));
  END IF;
END $$;
