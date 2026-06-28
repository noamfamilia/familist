-- Persist UI text direction (ltr | rtl) on user profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS text_direction text NOT NULL DEFAULT 'ltr';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_text_direction_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_text_direction_check CHECK (text_direction IN ('ltr', 'rtl'));

COMMENT ON COLUMN public.profiles.text_direction IS 'UI text direction: ltr or rtl.';
