-- Migrate items from legacy card_color (text) to category (1–6), or add category for new DBs.
-- Run once in Supabase SQL editor.

alter table public.items add column if not exists category smallint;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'items' and column_name = 'card_color'
  ) then
    update public.items set category = case btrim(card_color::text)
      when 'default' then 1
      when 'mint' then 2
      when 'coral' then 3
      when 'sand' then 4
      when 'lilac' then 5
      when 'slate' then 6
      else 1
    end;

    alter table public.items drop constraint if exists items_card_color_check;
    alter table public.items drop column card_color;
  end if;
end $$;

update public.items set category = 1 where category is null;

alter table public.items alter column category set default 1;
alter table public.items alter column category set not null;

alter table public.items drop constraint if exists items_category_check;
alter table public.items add constraint items_category_check check (category between 1 and 6);
