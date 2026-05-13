alter table public.lists
  add column if not exists last_content_update timestamptz not null default now();

alter table public.list_users
  add column if not exists last_viewed timestamptz null;

with latest as (
  select l.id,
         greatest(
           coalesce(l.updated_at, '-infinity'::timestamptz),
           coalesce(max(i.updated_at), '-infinity'::timestamptz),
           coalesce(max(m.updated_at), '-infinity'::timestamptz),
           coalesce(max(ims.updated_at), '-infinity'::timestamptz),
           coalesce(l.server_created_at, '-infinity'::timestamptz),
           coalesce(l.client_created_at, '-infinity'::timestamptz),
           now()
         ) as touched_at
  from public.lists l
  left join public.items i on i.list_id = l.id
  left join public.members m on m.list_id = l.id
  left join public.item_member_state ims on ims.item_id = i.id
  group by l.id
)
update public.lists l
set last_content_update = latest.touched_at
from latest
where l.id = latest.id
  and l.last_content_update is distinct from latest.touched_at;

create or replace function public.update_list_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_list_id uuid;
  v_touched_at timestamptz := statement_timestamp();
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
    set last_content_update = greatest(l.last_content_update, v_touched_at)
    where l.id = v_list_id
      and l.last_content_update < v_touched_at;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_items_last_content_update on public.items;
create trigger trg_items_last_content_update
after insert or update or delete on public.items
for each row execute function public.update_list_timestamp();

drop trigger if exists trg_members_last_content_update on public.members;
create trigger trg_members_last_content_update
after insert or update or delete on public.members
for each row execute function public.update_list_timestamp();

drop trigger if exists trg_ims_last_content_update on public.item_member_state;
create trigger trg_ims_last_content_update
after insert or update or delete on public.item_member_state
for each row execute function public.update_list_timestamp();

create or replace function public.touch_list_viewed(p_list_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.list_users
  set last_viewed = v_now
  where list_id = p_list_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Access denied';
  end if;

  return v_now;
end;
$$;

revoke all on function public.touch_list_viewed(uuid) from public;
grant execute on function public.touch_list_viewed(uuid) to authenticated;

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
          'client_created_at', l.client_created_at,
          'server_created_at', l.server_created_at,
          'deleted_at', l.deleted_at,
          'version', l.version,
          'last_synced_at', l.last_synced_at,
          'role', lu.role,
          'userArchived', lu.archived,
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
