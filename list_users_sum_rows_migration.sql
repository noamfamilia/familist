-- Per-user list preferences: optional summary rows (sum cards) on the list page.
ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS sum_all boolean NOT NULL DEFAULT false;
ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS sum_active boolean NOT NULL DEFAULT false;
ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS sum_archived boolean NOT NULL DEFAULT false;
