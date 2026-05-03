-- Bulk add active items to an existing list (run in Supabase SQL editor).
-- Editors/owners only. Applies one category to all lines. Creates target member_state rows when the list has a target member.

create or replace function public.bulk_add_list_items(
  p_list_id uuid,
  p_category smallint,
  p_lines text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_id uuid;
  v_cat smallint;
  v_cnt int;
  v_in_len int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.list_users
    where list_id = p_list_id
      and user_id = v_user_id
      and role in ('owner', 'editor')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_lines is null then
    raise exception 'p_lines is required';
  end if;

  v_in_len := coalesce(cardinality(p_lines), 0);
  if v_in_len > 500 then
    raise exception 'Too many lines (max 500)';
  end if;

  v_cat := least(greatest(coalesce(p_category, 1)::integer, 1), 6)::smallint;

  select id into v_target_id
  from public.members
  where list_id = p_list_id
    and is_target = true
  limit 1;

  with raw as (
    select trim(l) as t, ord
    from unnest(p_lines) with ordinality as x(l, ord)
  ),
  filtered as (
    select left(t, 2000) as text, row_number() over (order by ord)::int as rn
    from raw
    where length(trim(t)) > 0
  ),
  mx as (
    select coalesce(max(sort_order), -1) as m
    from public.items
    where list_id = p_list_id
  ),
  ins as (
    insert into public.items (list_id, text, sort_order, category, archived, archived_at)
    select
      p_list_id,
      f.text,
      mx.m + f.rn,
      v_cat,
      false,
      null
    from filtered f
    cross join mx
    returning id
  ),
  ims as (
    insert into public.item_member_state (item_id, member_id, quantity, done, assigned)
    select i.id, v_target_id, 1, false, true
    from ins i
    where v_target_id is not null
    returning item_id
  )
  select count(*)::int into v_cnt
  from ins
  cross join (select coalesce((select count(*) from ims), 0) as _force_ims) _x;

  return coalesce(v_cnt, 0);
end;
$$;

revoke all on function public.bulk_add_list_items(uuid, smallint, text[]) from public;
grant execute on function public.bulk_add_list_items(uuid, smallint, text[]) to authenticated;
