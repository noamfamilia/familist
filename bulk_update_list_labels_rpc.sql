-- Bulk update labels for multiple lists that belong to the current user.
-- p_updates: jsonb array of objects: [{ "list_id": "<uuid>", "label": "<text>" }, ...]

create or replace function public.bulk_update_list_labels(p_updates jsonb)
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

  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    raise exception 'p_updates must be a JSON array';
  end if;

  with raw as (
    select
      nullif(trim(x->>'list_id'), '')::uuid as list_id,
      coalesce(x->>'label', '') as label
    from jsonb_array_elements(p_updates) as x
  ),
  cleaned as (
    select distinct list_id, left(label, 200) as label
    from raw
    where list_id is not null
  ),
  unauthorized as (
    select c.list_id
    from cleaned c
    where not exists (
      select 1
      from public.list_users lu
      where lu.list_id = c.list_id
        and lu.user_id = v_user_id
    )
  )
  update public.list_users lu
  set label = c.label
  from cleaned c
  where lu.list_id = c.list_id
    and lu.user_id = v_user_id
    and not exists (select 1 from unauthorized);

  if exists (select 1 from unauthorized) then
    raise exception 'Invalid list id for current user';
  end if;
end;
$$;

revoke all on function public.bulk_update_list_labels(jsonb) from public;
grant execute on function public.bulk_update_list_labels(jsonb) to authenticated;
