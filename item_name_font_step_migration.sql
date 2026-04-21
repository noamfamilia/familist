-- Per-user-per-list item name font size (0–6; app default 3 = text-lg).
-- Run in Supabase SQL editor or psql after review.

ALTER TABLE public.list_users
  ADD COLUMN IF NOT EXISTS item_name_font_step smallint
  NOT NULL
  DEFAULT 3
  CHECK (item_name_font_step >= 0 AND item_name_font_step <= 6);

COMMENT ON COLUMN public.list_users.item_name_font_step IS
  'Item name font size step 0–6 (default 3). Matches app ITEM_NAME_FONT_* constants.';
