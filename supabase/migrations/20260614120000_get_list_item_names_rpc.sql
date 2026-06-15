-- Item names for list-card copy (active by sort_order, then archived by archived_at desc).

create or replace function public.get_list_item_names(p_list_id uuid)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.list_users
    where list_id = p_list_id and user_id = auth.uid()
  ) then
    raise exception 'Access denied';
  end if;

  return (
    select coalesce(array_agg(sub.text order by sub.ord), array[]::text[])
    from (
      select
        i.text,
        row_number() over (
          order by
            case when i.archived then 1 else 0 end,
            case when not i.archived then coalesce(i.sort_order, 0) end,
            case when i.archived then i.archived_at end desc nulls last,
            i.id
        ) as ord
      from public.items i
      where i.list_id = p_list_id
        and i.deleted_at is null
    ) sub
  );
end;
$$;

revoke all on function public.get_list_item_names(uuid) from public;
grant execute on function public.get_list_item_names(uuid) to authenticated;
