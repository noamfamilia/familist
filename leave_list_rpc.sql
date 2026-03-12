create or replace function public.leave_list(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if exists (
    select 1
    from public.list_users
    where list_id = p_list_id
      and user_id = v_user_id
      and role = 'owner'
  ) then
    raise exception 'Owners cannot leave their own list';
  end if;

  if not exists (
    select 1
    from public.list_users
    where list_id = p_list_id
      and user_id = v_user_id
  ) then
    raise exception 'You are not part of this list';
  end if;

  delete from public.members
  where list_id = p_list_id
    and created_by = v_user_id;

  delete from public.list_users
  where list_id = p_list_id
    and user_id = v_user_id;
end;
$$;

grant execute on function public.leave_list(uuid) to authenticated;
