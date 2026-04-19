-- Update import_list RPC to support an optional "target" column from sheet imports.
-- When p_has_targets is true, creates a Targets member (is_target=true) and
-- populates item_member_state rows with quantity from each row's "target" field.

create or replace function public.import_list(
  p_name text,
  p_label text default '',
  p_category_names text default null,
  p_rows jsonb default '[]'::jsonb,
  p_has_targets boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_new_list public.lists%rowtype;
  v_len int;
  v_target_member_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_trimmed_name = '' then
    raise exception 'List name is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  v_len := jsonb_array_length(p_rows);
  if v_len > 2000 then
    raise exception 'Too many rows (max 2000)';
  end if;

  -- Insert the list (trigger auto-creates list_users row with role='owner')
  insert into public.lists (name, owner_id)
  values (v_trimmed_name, v_user_id)
  returning * into v_new_list;

  -- Set category_names if provided
  if p_category_names is not null and p_category_names <> '' and p_category_names <> '{}' then
    update public.lists
    set category_names = p_category_names
    where id = v_new_list.id;

    v_new_list.category_names := p_category_names;
  end if;

  -- Bulk insert items (all treated as active)
  if v_len > 0 then
    insert into public.items (list_id, text, sort_order, category, comment)
    select
      v_new_list.id,
      left(trim(r.elem->>'text'), 2000),
      coalesce((r.elem->>'sort_order')::integer, 0),
      least(greatest(coalesce((r.elem->>'category')::integer, 1), 1), 6)::smallint,
      nullif(left(trim(r.elem->>'comment'), 5000), '')
    from jsonb_array_elements(p_rows) with ordinality as r(elem, idx)
    where length(trim(r.elem->>'text')) > 0;
  end if;

  -- Create Targets member and item_member_state rows if target column was present
  if p_has_targets and v_len > 0 then
    insert into public.members (list_id, name, created_by, sort_order, is_public, is_target)
    values (v_new_list.id, 'Qty', v_user_id, 0, false, true)
    returning id into v_target_member_id;

    insert into public.item_member_state (item_id, member_id, quantity, done, assigned)
    select
      i.id,
      v_target_member_id,
      greatest(coalesce((r.elem->>'target')::integer, 1), 1),
      false,
      true
    from public.items i
    join jsonb_array_elements(p_rows) with ordinality as r(elem, idx)
      on i.sort_order = coalesce((r.elem->>'sort_order')::integer, 0)
    where i.list_id = v_new_list.id
      and length(trim(r.elem->>'text')) > 0;
  end if;

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

  return to_jsonb(v_new_list);
end;
$$;

-- Need to drop the old signature first since we added a parameter
drop function if exists public.import_list(text, text, text, jsonb);
grant execute on function public.import_list(text, text, text, jsonb, boolean) to authenticated;
