-- Bulk delete / restore archived items (single round-trip; matches prod RPC from familist_rpc_may11.txt)

create or replace function public.delete_archived_items(p_list_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
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


create or replace function public.restore_archived_items(p_list_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
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

  update public.items
  set archived = false,
      archived_at = null,
      updated_at = now()
  where list_id = p_list_id and archived = true;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.restore_archived_items(uuid) to authenticated;
