alter table public.lists
  add column if not exists join_token text;

alter table public.lists
  drop constraint if exists lists_join_token_hash_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lists_join_token_key'
  ) then
    alter table public.lists
      add constraint lists_join_token_key unique (join_token);
  end if;
end $$;

drop function if exists public.generate_share_token(uuid);

create or replace function public.join_list_by_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list_id uuid;
  v_role text;
  v_owner_id uuid;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'Token is required';
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select l.id, l.join_role_granted, l.owner_id
    into v_list_id, v_role, v_owner_id
  from public.lists l
  where l.join_token is not null
    and l.join_revoked_at is null
    and (l.join_expires_at is null or l.join_expires_at > now())
    and l.join_token = p_token
  limit 1;

  if v_list_id is null then
    raise exception 'Invalid, expired, or revoked token';
  end if;

  if v_owner_id = auth.uid() then
    raise exception 'You cannot join your own list';
  end if;

  insert into public.list_users(list_id, user_id, role)
  values (v_list_id, auth.uid(), v_role)
  on conflict (list_id, user_id) do update
    set role = excluded.role;

  -- Shift existing sort_order values up by 1 to make room at position 0
  update public.list_users
  set sort_order = coalesce(sort_order, 0) + 1
  where user_id = auth.uid()
    and list_id != v_list_id;

  -- Place the joined list at position 0
  update public.list_users
  set sort_order = 0
  where list_id = v_list_id
    and user_id = auth.uid();

  update public.lists
  set join_use_count = join_use_count + 1
  where id = v_list_id;

  return v_list_id;
end;
$$;

revoke all on function public.join_list_by_token(text) from public;
grant execute on function public.join_list_by_token(text) to authenticated;

create or replace function public.generate_share_token(
  p_list_id uuid,
  p_force_regenerate boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_token text;
  v_token text;
begin
  select join_token
    into v_existing_token
  from public.lists
  where id = p_list_id
    and owner_id = auth.uid();

  if v_existing_token is null and not exists (
    select 1
    from public.lists
    where id = p_list_id
      and owner_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;

  if v_existing_token is not null and not p_force_regenerate then
    update public.lists
    set visibility = 'link',
        join_revoked_at = null
    where id = p_list_id;

    return v_existing_token;
  end if;

  loop
    v_token := encode(extensions.gen_random_bytes(12), 'hex');
    exit when not exists (
      select 1
      from public.lists
      where join_token = v_token
    );
  end loop;

  update public.lists
  set visibility = 'link',
      join_token = v_token,
      join_revoked_at = null
  where id = p_list_id;

  return v_token;
end;
$$;

revoke all on function public.generate_share_token(uuid, boolean) from public;
grant execute on function public.generate_share_token(uuid, boolean) to authenticated;

create or replace function public.revoke_share_token(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.lists 
    where id = p_list_id and owner_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;

  delete from public.list_users
  where list_id = p_list_id and role != 'owner';

  update public.lists
  set visibility = 'private',
      join_token = null,
      join_revoked_at = now()
  where id = p_list_id;
end;
$$;

revoke all on function public.revoke_share_token(uuid) from public;
grant execute on function public.revoke_share_token(uuid) to authenticated;

alter table public.lists
  drop column if exists join_token_hash;
