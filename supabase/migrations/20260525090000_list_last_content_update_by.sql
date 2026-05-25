-- Track who authored the most recent content change on a list so the home "new activity" LED can
-- suppress for the author. Without this, the LED lights up after your own reorder because the
-- server stamps `last_content_update` with `statement_timestamp()` AFTER your client-stamped
-- `last_viewed` was sent, so `content > viewed` is true even though you literally just made the
-- change.

alter table public.lists
  add column if not exists last_content_update_by uuid null
  references auth.users(id) on delete set null;

-- Update the existing trigger to also stamp the author. Only update both fields together when the
-- new server timestamp actually wins, so a stale catch-up write can't overwrite an authoritative
-- author with the wrong user.
create or replace function public.update_list_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_list_id uuid;
  v_touched_at timestamptz := statement_timestamp();
  v_actor uuid := auth.uid();
begin
  if TG_TABLE_NAME = 'item_member_state' then
    select i.list_id
      into v_list_id
    from public.items i
    where i.id = case when TG_OP = 'DELETE' then OLD.item_id else NEW.item_id end;
  elsif TG_OP = 'DELETE' then
    v_list_id := OLD.list_id;
  else
    v_list_id := NEW.list_id;
  end if;

  if v_list_id is not null then
    update public.lists l
    set
      last_content_update = greatest(l.last_content_update, v_touched_at),
      last_content_update_by = v_actor
    where l.id = v_list_id
      and l.last_content_update < v_touched_at;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

-- Expose the new column to the client via the catalog RPC.
create or replace function public.get_user_lists()
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
    select coalesce(json_agg(x.row_json order by x.ord desc nulls last, x.ca desc), '[]'::json)
    from (
      select
        json_build_object(
          'id', l.id,
          'name', l.name,
          'owner_id', l.owner_id,
          'visibility', l.visibility,
          'archived', l.archived,
          'updated_at', l.updated_at,
          'last_content_update', l.last_content_update,
          'last_content_update_by', l.last_content_update_by,
          'client_created_at', l.client_created_at,
          'server_created_at', l.server_created_at,
          'deleted_at', l.deleted_at,
          'version', l.version,
          'last_synced_at', l.last_synced_at,
          'role', lu.role,
          'userArchived', lu.archived,
          'userArchivedAt', lu.archived_at,
          'sort_order', lu.sort_order,
          'last_viewed', lu.last_viewed,
          'sumScope', lu.sum_scope,
          'ownerNickname', case
            when lu.role <> 'owner' then (select p.nickname from public.profiles p where p.id = l.owner_id)
            else null
          end,
          'comment', l.comment,
          'label', coalesce(lu.label, '')
        ) as row_json,
        lu.sort_order as ord,
        coalesce(l.server_created_at, l.client_created_at) as ca
      from public.list_users lu
      join public.lists l on l.id = lu.list_id
      where lu.user_id = auth.uid()
    ) x
  );
end;
$$;

revoke all on function public.get_user_lists() from public;
grant execute on function public.get_user_lists() to authenticated;
