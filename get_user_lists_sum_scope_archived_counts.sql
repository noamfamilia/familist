-- Adds sumScope (from list_users.sum_scope) and archivedItemCount for home list cards
-- when sum row is enabled. Also counts members excluding targets.
--
-- Postgres rejects CREATE OR REPLACE when the return type is considered changed; drop first.
DROP FUNCTION IF EXISTS public.get_user_lists();

CREATE OR REPLACE FUNCTION public.get_user_lists()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return (
    select coalesce(json_agg(x.row_json order by x.ord nulls last, x.ca desc), '[]'::json)
    from (
      select json_build_object(
        'id', l.id,
        'name', l.name,
        'owner_id', l.owner_id,
        'visibility', l.visibility,
        'archived', l.archived,
        'created_at', l.created_at,
        'updated_at', l.updated_at,
        'role', lu.role,
        'userArchived', lu.archived,
        'memberCount', (
          select count(*)::int
          from public.members m
          where m.list_id = l.id and not coalesce(m.is_target, false)
        ),
        'activeItemCount', (
          select count(*)::int
          from public.items i
          where i.list_id = l.id and not i.archived
        ),
        'archivedItemCount', (
          select count(*)::int
          from public.items i
          where i.list_id = l.id and i.archived
        ),
        'sumScope', lu.sum_scope,
        'ownerNickname', case
          when lu.role <> 'owner' then (select p.nickname from public.profiles p where p.id = l.owner_id)
          else null
        end,
        'comment', l.comment,
        'category_names', l.category_names,
        'category_order', l.category_order,
        'label', coalesce(lu.label, '')
      ) as row_json,
      lu.sort_order as ord,
      l.created_at as ca
      from public.list_users lu
      join public.lists l on l.id = lu.list_id
      where lu.user_id = auth.uid()
    ) x
  );
end;
$$;

revoke all on function public.get_user_lists() from public;
grant execute on function public.get_user_lists() to authenticated;
