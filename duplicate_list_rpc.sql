create or replace function public.duplicate_list(p_source_list_id uuid, p_new_name text)
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

  select jsonb_build_object(
    'list', to_jsonb(v_new_list),
    'items', coalesce(
      (
        select jsonb_agg(
          to_jsonb(i) || jsonb_build_object('memberStates', '{}'::jsonb)
          order by i.archived, i.sort_order nulls last, i.created_at, i.id
        )
        from public.items i
        where i.list_id = v_new_list.id
      ),
      '[]'::jsonb
    ),
    'members', '[]'::jsonb
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.duplicate_list(uuid, text) to authenticated;
