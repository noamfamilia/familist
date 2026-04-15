create or replace function public.own_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_source public.members%rowtype;
  v_new_id uuid;
  v_temp_name text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_source
  from public.members
  where id = p_member_id;

  if not found then
    raise exception 'Member not found';
  end if;

  if v_source.created_by = v_user_id then
    raise exception 'You already own this member';
  end if;

  if not v_source.is_public then
    raise exception 'Member is not public';
  end if;

  if not exists (
    select 1 from public.list_users
    where list_id = v_source.list_id and user_id = v_user_id
  ) then
    raise exception 'Access denied';
  end if;

  -- Rename source member to a temp name to free the unique constraint slot
  v_temp_name := v_source.name || '__transfer__' || gen_random_uuid()::text;
  update public.members
  set name = v_temp_name, updated_at = now()
  where id = p_member_id;

  -- Insert new member with same name, sort_order, owned by calling user, private
  insert into public.members (list_id, name, created_by, sort_order, is_public)
  values (v_source.list_id, v_source.name, v_user_id, v_source.sort_order, false)
  returning id into v_new_id;

  -- Copy all item_member_state rows from old member to new member
  insert into public.item_member_state (item_id, member_id, quantity, done, assigned, updated_at)
  select item_id, v_new_id, quantity, done, assigned, now()
  from public.item_member_state
  where member_id = p_member_id;

  -- Delete old member (cascades to its item_member_state rows)
  delete from public.members where id = p_member_id;

  -- Return new member with creator nickname
  select jsonb_build_object(
    'member', to_jsonb(m) || jsonb_build_object(
      'creator', (select jsonb_build_object('nickname', p.nickname) from public.profiles p where p.id = m.created_by)
    )
  )
  into v_result
  from public.members m
  where m.id = v_new_id;

  return v_result;
end;
$$;

grant execute on function public.own_member(uuid) to authenticated;
