create or replace function public.create_list(p_name text, p_label text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_new_list public.lists%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_trimmed_name = '' then
    raise exception 'List name is required';
  end if;

  -- Insert the list (trigger auto-creates list_users row with role='owner')
  insert into public.lists (name, owner_id)
  values (v_trimmed_name, v_user_id)
  returning * into v_new_list;

  -- Shift existing sort_order values up by 1 to make room at position 0
  update public.list_users
  set sort_order = coalesce(sort_order, 0) + 1
  where user_id = v_user_id
    and list_id != v_new_list.id;

  -- Set the new list to position 0 and apply label
  update public.list_users
  set sort_order = 0,
      label = coalesce(nullif(btrim(p_label), ''), '')
  where list_id = v_new_list.id
    and user_id = v_user_id;

  return to_jsonb(v_new_list);
end;
$$;

grant execute on function public.create_list(text, text) to authenticated;
