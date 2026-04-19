create or replace function public.duplicate_list(p_source_list_id uuid, p_new_name text, p_label text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_new_name, ''));
  v_new_list public.lists%rowtype;
  v_result jsonb;
  v_source_target_id uuid;
  v_new_target_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_trimmed_name = '' then
    raise exception 'List name is required';
  end if;

  if not exists (
    select 1
    from public.list_users
    where list_id = p_source_list_id
      and user_id = v_user_id
  ) then
    raise exception 'Access denied';
  end if;

  insert into public.lists (name, owner_id)
  values (v_trimmed_name, v_user_id)
  returning * into v_new_list;

  insert into public.items (list_id, text, comment, archived, archived_at, sort_order, category)
  select
    v_new_list.id,
    i.text,
    i.comment,
    i.archived,
    i.archived_at,
    i.sort_order,
    i.category
  from public.items i
  where i.list_id = p_source_list_id
  order by i.archived, i.sort_order nulls last, i.created_at, i.id;

  -- Shift existing sort_order values up by 1 to make room at position 0
  update public.list_users
  set sort_order = coalesce(sort_order, 0) + 1
  where user_id = v_user_id
    and list_id != v_new_list.id;

  -- Set the new list to position 0, apply label and item_text_width
  update public.list_users
  set sort_order = 0,
      label = coalesce(nullif(btrim(p_label), ''), ''),
      item_text_width = 'auto'
  where list_id = v_new_list.id
    and user_id = v_user_id;

  -- Copy Qty (target) member and per-item target quantities if the source list has one
  select m.id
    into v_source_target_id
  from public.members m
  where m.list_id = p_source_list_id
    and m.is_target = true
  limit 1;

  if v_source_target_id is not null then
    insert into public.members (list_id, name, created_by, sort_order, is_public, is_target)
    select
      v_new_list.id,
      m.name,
      v_user_id,
      0,
      false,
      true
    from public.members m
    where m.id = v_source_target_id
    returning id into v_new_target_id;

    insert into public.item_member_state (item_id, member_id, quantity, done, assigned, updated_at)
    select
      map.new_item_id,
      v_new_target_id,
      ims.quantity,
      ims.done,
      ims.assigned,
      now()
    from (
      select o.id as old_item_id, n.id as new_item_id
      from (
        select
          id,
          row_number() over (order by archived, sort_order nulls last, created_at, id) as rn
        from public.items
        where list_id = p_source_list_id
      ) o
      join (
        select
          id,
          row_number() over (order by archived, sort_order nulls last, created_at, id) as rn
        from public.items
        where list_id = v_new_list.id
      ) n using (rn)
    ) map
    join public.item_member_state ims
      on ims.item_id = map.old_item_id
     and ims.member_id = v_source_target_id;
  end if;

  -- Same shape as opening a list (members, items with memberStates)
  v_result := (select get_list_data(v_new_list.id))::jsonb;

  return v_result;
end;
$$;

grant execute on function public.duplicate_list(uuid, text, text) to authenticated;
