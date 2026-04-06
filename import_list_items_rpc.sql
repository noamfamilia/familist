-- Bulk insert items for sheet import (run in Supabase SQL editor).
-- p_rows: jsonb array of { "text", "sort_order", "category", "comment", "archived" }

create or replace function public.import_list_items(p_list_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_len int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.list_users
    where list_id = p_list_id
      and user_id = auth.uid()
      and role in ('owner', 'editor')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  v_len := jsonb_array_length(p_rows);
  if v_len = 0 then
    return;
  end if;

  if v_len > 2000 then
    raise exception 'Too many rows (max 2000)';
  end if;

  insert into public.items (list_id, text, sort_order, category, comment, archived, archived_at)
  select
    p_list_id,
    left(trim(r.elem->>'text'), 2000),
    coalesce((r.elem->>'sort_order')::integer, 0),
    least(
      greatest(
        coalesce(
          case
            when jsonb_typeof(r.elem->'category') = 'number'
              then (r.elem->'category')::text::integer
            else nullif(trim(r.elem->>'category'), '')::integer
          end,
          1
        ),
        1
      ),
      6
    )::smallint,
    nullif(left(trim(r.elem->>'comment'), 5000), ''),
    coalesce((r.elem->>'archived')::boolean, false),
    case when coalesce((r.elem->>'archived')::boolean, false) then now() else null end
  from jsonb_array_elements(p_rows) with ordinality as r(elem, idx)
  where length(trim(r.elem->>'text')) > 0;
end;
$$;

revoke all on function public.import_list_items(uuid, jsonb) from public;
grant execute on function public.import_list_items(uuid, jsonb) to authenticated;
