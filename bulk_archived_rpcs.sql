-- Delete all archived items in a list (cascades to item_member_state via FK)
create or replace function public.delete_archived_items(p_list_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.list_users
    where list_id = p_list_id and user_id = v_user_id
  ) then
    raise exception 'Access denied';
  end if;

  delete from public.items
  where list_id = p_list_id and archived = true;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.delete_archived_items(uuid) to authenticated;


-- Restore all archived items in a list
create or replace function public.restore_archived_items(p_list_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_max_sort int;
  v_count int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.list_users
    where list_id = p_list_id and user_id = v_user_id
  ) then
    raise exception 'Access denied';
  end if;

  select coalesce(max(sort_order), -1)
  into v_max_sort
  from public.items
  where list_id = p_list_id and archived = false;

  with numbered as (
    select id, row_number() over (order by archived_at asc nulls last, created_at asc) as rn
    from public.items
    where list_id = p_list_id and archived = true
  )
  update public.items i
  set archived = false,
      archived_at = null,
      sort_order = v_max_sort + n.rn
  from numbered n
  where i.id = n.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.restore_archived_items(uuid) to authenticated;
