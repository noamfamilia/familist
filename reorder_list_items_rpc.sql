-- Bulk update item sort_order in one transaction (run in Supabase SQL editor).
-- p_item_ids: every item id for p_list_id, in desired order (sort_order = index 0..n-1).

create or replace function public.reorder_list_items(p_list_id uuid, p_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.list_users
    where list_id = p_list_id
      and user_id = auth.uid()
      and role in ('owner', 'editor')
  ) then
    raise exception 'Not authorized';
  end if;

  select count(*)::int into v_expected from public.items where list_id = p_list_id;

  if v_expected = 0 then
    return;
  end if;

  if p_item_ids is null or coalesce(array_length(p_item_ids, 1), 0) <> v_expected then
    raise exception 'Item id list must include every item in the list exactly once';
  end if;

  if (select count(distinct x.id) from unnest(p_item_ids) as x(id)) <> v_expected then
    raise exception 'Duplicate item ids';
  end if;

  if exists (
    select 1 from unnest(p_item_ids) u(id)
    where not exists (
      select 1 from public.items i where i.id = u.id and i.list_id = p_list_id
    )
  ) then
    raise exception 'Invalid item id for this list';
  end if;

  update public.items i
  set sort_order = t.ord::int - 1,
      updated_at = now()
  from unnest(p_item_ids) with ordinality as t(id, ord)
  where i.id = t.id and i.list_id = p_list_id;
end;
$$;

revoke all on function public.reorder_list_items(uuid, uuid[]) from public;
grant execute on function public.reorder_list_items(uuid, uuid[]) to authenticated;
