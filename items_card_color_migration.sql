-- Run on Supabase (SQL editor or migration) to add per-item card colors.
-- Safe to run once; uses IF NOT EXISTS for the column.

alter table public.items
  add column if not exists card_color text not null default 'default';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'items_card_color_check'
      and conrelid = 'public.items'::regclass
  ) then
    alter table public.items
      add constraint items_card_color_check
      check (card_color in ('default', 'mint', 'coral', 'sand', 'lilac', 'slate'));
  end if;
end $$;
