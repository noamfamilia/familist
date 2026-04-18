-- Update all existing list_users to use 'all' member_filter
UPDATE public.list_users SET member_filter = 'all' WHERE member_filter <> 'all';

-- Change the column default for new rows
ALTER TABLE public.list_users ALTER COLUMN member_filter SET DEFAULT 'all';
