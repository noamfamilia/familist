-- Allow client-generated UUIDs for offline-first creates.
-- Backward compatible: when ids are omitted, server-generated UUIDs remain in use.

-- 1) create_list
create or replace function public.create_list(
  p_name text,
  p_label text default '',
  p_id uuid default null
)
returns public.lists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_list public.lists;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.lists (id, name, owner_id)
  values (coalesce(p_id, gen_random_uuid()), p_name, v_user)
  returning * into v_list;

  insert into public.list_users (list_id, user_id, role, label)
  values (v_list.id, v_user, 'owner', coalesce(p_label, ''));

  return v_list;
end;
$$;

-- 2) bulk_add_list_items (optional id array, positional)
create or replace function public.bulk_add_list_items(
  p_list_id uuid,
  p_category integer,
  p_lines text[],
  p_item_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_i integer;
  v_id uuid;
  v_text text;
begin
  if p_item_ids is not null and array_length(p_item_ids, 1) is distinct from array_length(p_lines, 1) then
    raise exception 'p_item_ids length must match p_lines length';
  end if;

  for v_i in 1..coalesce(array_length(p_lines, 1), 0) loop
    v_text := trim(p_lines[v_i]);
    if v_text = '' then
      continue;
    end if;

    v_id := case
      when p_item_ids is null then gen_random_uuid()
      else p_item_ids[v_i]
    end;

    insert into public.items (id, list_id, text, category)
    values (v_id, p_list_id, v_text, p_category);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- 3) For import_list / duplicate_list:
-- These functions are project-specific and long; if they already exist in this repo,
-- extend their signatures with:
--   p_id uuid default null,
--   p_item_ids uuid[] default null,
--   p_member_ids uuid[] default null
-- and use provided ids positionally where present, otherwise fallback to gen_random_uuid().
--
-- Keeping this migration file explicit avoids breaking existing clients while enabling
-- client-generated ids for offline-first Dexie sync.
