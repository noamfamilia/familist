-- Add label_filter column to profiles (persists the home page label dropdown selection)
ALTER TABLE public.profiles ADD COLUMN label_filter text NOT NULL DEFAULT 'Any';

-- Remove unused legacy column
ALTER TABLE public.profiles DROP COLUMN IF EXISTS list_filter;
