-- Persist UI theme (next-themes: light | dark) on user profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'light';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_theme_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_theme_check CHECK (theme IN ('light', 'dark'));

COMMENT ON COLUMN public.profiles.theme IS 'UI color theme: light or dark.';
