-- Syncable row metadata (ISO strings in the app; timestamptz in Postgres).
-- Run once via Supabase CLI or SQL editor.
--
-- After this migration, update any RPC / view that lists columns explicitly, e.g.:
--   `get_user_lists` must expose `client_created_at`, `server_created_at`, `deleted_at`,
--   `version`, `last_synced_at` (not `created_at`) so the web client matches `src/lib/supabase/types.ts`.

-- ---------- lists ----------
ALTER TABLE public.lists RENAME COLUMN created_at TO server_created_at;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS client_created_at timestamptz;
UPDATE public.lists SET client_created_at = server_created_at WHERE client_created_at IS NULL;
ALTER TABLE public.lists ALTER COLUMN client_created_at SET NOT NULL;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- ---------- items ----------
ALTER TABLE public.items RENAME COLUMN created_at TO server_created_at;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS client_created_at timestamptz;
UPDATE public.items SET client_created_at = server_created_at WHERE client_created_at IS NULL;
ALTER TABLE public.items ALTER COLUMN client_created_at SET NOT NULL;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- ---------- members ----------
ALTER TABLE public.members RENAME COLUMN created_at TO server_created_at;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS client_created_at timestamptz;
UPDATE public.members SET client_created_at = server_created_at WHERE client_created_at IS NULL;
ALTER TABLE public.members ALTER COLUMN client_created_at SET NOT NULL;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- ---------- list_users ----------
ALTER TABLE public.list_users RENAME COLUMN created_at TO server_created_at;
ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS client_created_at timestamptz;
UPDATE public.list_users SET client_created_at = server_created_at WHERE client_created_at IS NULL;
ALTER TABLE public.list_users ALTER COLUMN client_created_at SET NOT NULL;
ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;
ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- ---------- profiles ----------
ALTER TABLE public.profiles RENAME COLUMN created_at TO server_created_at;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS client_created_at timestamptz;
UPDATE public.profiles SET client_created_at = server_created_at WHERE client_created_at IS NULL;
ALTER TABLE public.profiles ALTER COLUMN client_created_at SET NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- ---------- feedback ----------
ALTER TABLE public.feedback RENAME COLUMN created_at TO server_created_at;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS client_created_at timestamptz;
UPDATE public.feedback SET client_created_at = COALESCE(server_created_at, now()) WHERE client_created_at IS NULL;
ALTER TABLE public.feedback ALTER COLUMN client_created_at SET NOT NULL;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- ---------- item_member_state ----------
ALTER TABLE public.item_member_state ADD COLUMN IF NOT EXISTS client_created_at timestamptz;
UPDATE public.item_member_state SET client_created_at = updated_at WHERE client_created_at IS NULL;
ALTER TABLE public.item_member_state ALTER COLUMN client_created_at SET NOT NULL;
ALTER TABLE public.item_member_state ADD COLUMN IF NOT EXISTS server_created_at timestamptz NULL;
UPDATE public.item_member_state SET server_created_at = updated_at WHERE server_created_at IS NULL;
ALTER TABLE public.item_member_state ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.item_member_state ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL;
ALTER TABLE public.item_member_state ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- Bump `version` on meaningful writes from your RPCs or add a guarded trigger here.
