-- Reorder all list cards for the current user in one call.
-- p_list_ids: every list id visible to auth.uid(), in desired order (sort_order = index 0..n-1).

create or replace function public.reorder_user_lists(p_list_ids uuid[])
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

  select count(*)::int
    into v_expected
  from public.list_users
  where user_id = auth.uid();

  if v_expected = 0 then
    return;
  end if;

  if p_list_ids is null or coalesce(array_length(p_list_ids, 1), 0) <> v_expected then
    raise exception 'List id list must include every user list exactly once';
  end if;

  if (select count(distinct x.id) from unnest(p_list_ids) as x(id)) <> v_expected then
    raise exception 'Duplicate list ids';
  end if;

  if exists (
    select 1
    from unnest(p_list_ids) u(id)
    where not exists (
      select 1
      from public.list_users lu
      where lu.list_id = u.id
        and lu.user_id = auth.uid()
    )
  ) then
    raise exception 'Invalid list id for current user';
  end if;

  update public.list_users lu
  set sort_order = t.ord::int - 1
  from unnest(p_list_ids) with ordinality as t(id, ord)
  where lu.list_id = t.id
    and lu.user_id = auth.uid();
end;
$$;

revoke all on function public.reorder_user_lists(uuid[]) from public;
grant execute on function public.reorder_user_lists(uuid[]) to authenticated;
