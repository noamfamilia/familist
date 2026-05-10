-- RPCs that still INSERT partial rows after 20260507120000_syncable_row_fields.sql.
-- Replaces: handle_new_user, change_quantity, own_member, import_list_items, bulk_add_list_items.

-- ---------------------------------------------------------------------------
-- handle_new_user → profiles (NOT NULL client_created_at, theme, label_filter)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    nickname,
    label_filter,
    theme,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'nickname',
    '',
    'light',
    now(),
    now(),
    NULL,
    1,
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    email = excluded.email,
    nickname = coalesce(excluded.nickname, public.profiles.nickname);

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- change_quantity → item_member_state insert path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_quantity(p_item_id uuid, p_member_id uuid, p_delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_qty integer;
  v_ts timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.items i
    JOIN public.list_users lu ON lu.list_id = i.list_id
    WHERE i.id = p_item_id
      AND lu.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.item_member_state (
    item_id,
    member_id,
    quantity,
    done,
    assigned,
    updated_at,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at
  )
  VALUES (
    p_item_id,
    p_member_id,
    greatest(p_delta, 0),
    false,
    false,
    v_ts,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL
  )
  ON CONFLICT (item_id, member_id) DO UPDATE
    SET quantity = greatest(public.item_member_state.quantity + p_delta, 0),
        updated_at = excluded.updated_at
  RETURNING quantity INTO v_new_qty;

  RETURN v_new_qty;
END;
$$;

REVOKE ALL ON FUNCTION public.change_quantity(uuid, uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.change_quantity(uuid, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- own_member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.own_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_source public.members%rowtype;
  v_new_id uuid;
  v_result jsonb;
  v_ts timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
    INTO v_source
  FROM public.members
  WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_source.created_by = v_user_id THEN
    RAISE EXCEPTION 'You already own this member';
  END IF;

  IF NOT v_source.is_public THEN
    RAISE EXCEPTION 'Member is not public';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users
    WHERE list_id = v_source.list_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  CREATE TEMPORARY TABLE IF NOT EXISTS _own_member_states (
    item_id uuid,
    quantity integer,
    done boolean,
    assigned boolean,
    updated_at timestamptz
  ) ON COMMIT DROP;

  TRUNCATE _own_member_states;

  INSERT INTO _own_member_states (item_id, quantity, done, assigned, updated_at)
  SELECT item_id, quantity, done, assigned, updated_at
  FROM public.item_member_state
  WHERE member_id = p_member_id;

  DELETE FROM public.members
  WHERE id = p_member_id;

  INSERT INTO public.members (
    list_id,
    name,
    created_by,
    sort_order,
    is_public,
    is_target,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at,
    updated_at
  )
  VALUES (
    v_source.list_id,
    v_source.name,
    v_user_id,
    CASE WHEN v_source.is_target THEN 0 ELSE v_source.sort_order END,
    false,
    v_source.is_target,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL,
    v_ts
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.item_member_state (
    item_id,
    member_id,
    quantity,
    done,
    assigned,
    updated_at,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at
  )
  SELECT
    s.item_id,
    v_new_id,
    s.quantity,
    s.done,
    s.assigned,
    v_ts,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL,
    v_ts
  FROM _own_member_states s;

  SELECT jsonb_build_object(
    'member',
    to_jsonb(m) || jsonb_build_object(
      'creator',
      (SELECT jsonb_build_object('nickname', p.nickname)
       FROM public.profiles p
       WHERE p.id = m.created_by)
    )
  )
  INTO v_result
  FROM public.members m
  WHERE m.id = v_new_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.own_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.own_member(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- import_list_items
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_list_items(p_list_id uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_len int;
  v_ts timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users
    WHERE list_id = p_list_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  v_len := jsonb_array_length(p_rows);
  IF v_len = 0 THEN
    RETURN;
  END IF;

  IF v_len > 2000 THEN
    RAISE EXCEPTION 'Too many rows (max 2000)';
  END IF;

  INSERT INTO public.items (
    id,
    list_id,
    text,
    sort_order,
    category,
    comment,
    archived,
    archived_at,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    p_list_id,
    left(trim(r.elem->>'text'), 2000),
    coalesce((r.elem->>'sort_order')::integer, 0),
    least(
      greatest(
        coalesce(
          CASE
            WHEN jsonb_typeof(r.elem->'category') = 'number'
              THEN (r.elem->'category')::text::integer
            ELSE nullif(trim(r.elem->>'category'), '')::integer
          END,
          1
        ),
        1
      ),
      6
    )::smallint,
    nullif(left(trim(r.elem->>'comment'), 5000), ''),
    coalesce((r.elem->>'archived')::boolean, false),
    CASE WHEN coalesce((r.elem->>'archived')::boolean, false) THEN v_ts ELSE NULL END,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL,
    v_ts
  FROM jsonb_array_elements(p_rows) WITH ordinality AS r(elem, idx)
  WHERE length(trim(r.elem->>'text')) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.import_list_items(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.import_list_items(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- bulk_add_list_items
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_add_list_items(
  p_list_id uuid,
  p_category smallint,
  p_lines text[],
  p_item_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_target_id uuid;
  v_cat smallint;
  v_cnt int;
  v_in_len int;
  v_ts timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users
    WHERE list_id = p_list_id
      AND user_id = v_user_id
      AND role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_lines IS NULL THEN
    RAISE EXCEPTION 'p_lines is required';
  END IF;

  v_in_len := coalesce(cardinality(p_lines), 0);
  IF v_in_len > 500 THEN
    RAISE EXCEPTION 'Too many lines (max 500)';
  END IF;

  IF p_item_ids IS NOT NULL AND cardinality(p_item_ids) IS DISTINCT FROM v_in_len THEN
    RAISE EXCEPTION 'p_item_ids length must match p_lines length';
  END IF;

  v_cat := least(greatest(coalesce(p_category, 1)::integer, 1), 6)::smallint;

  SELECT id
    INTO v_target_id
  FROM public.members
  WHERE list_id = p_list_id
    AND is_target = true
  LIMIT 1;

  WITH raw AS (
    SELECT trim(l) AS t, ord
    FROM unnest(p_lines) WITH ordinality AS x(l, ord)
  ),
  filtered AS (
    SELECT
      left(t, 2000) AS text,
      row_number() OVER (ORDER BY ord)::int AS rn
    FROM raw
    WHERE length(trim(t)) > 0
  ),
  mx AS (
    SELECT coalesce(max(sort_order), -1) AS m
    FROM public.items
    WHERE list_id = p_list_id
  ),
  ins AS (
    INSERT INTO public.items (
      id,
      list_id,
      text,
      sort_order,
      category,
      archived,
      archived_at,
      client_created_at,
      server_created_at,
      deleted_at,
      version,
      last_synced_at,
      updated_at
    )
    SELECT
      coalesce(
        CASE WHEN p_item_ids IS NULL THEN NULL ELSE p_item_ids[f.rn] END,
        gen_random_uuid()
      ),
      p_list_id,
      f.text,
      mx.m + f.rn,
      v_cat,
      false,
      NULL,
      v_ts,
      v_ts,
      NULL,
      1,
      NULL,
      v_ts
    FROM filtered f
    CROSS JOIN mx
    RETURNING id
  ),
  ims AS (
    INSERT INTO public.item_member_state (
      item_id,
      member_id,
      quantity,
      done,
      assigned,
      updated_at,
      client_created_at,
      server_created_at,
      deleted_at,
      version,
      last_synced_at
    )
    SELECT
      i.id,
      v_target_id,
      1,
      false,
      true,
      v_ts,
      v_ts,
      v_ts,
      NULL,
      1,
      NULL,
      v_ts
    FROM ins i
    WHERE v_target_id IS NOT NULL
    RETURNING item_id
  )
  SELECT count(*)::int
    INTO v_cnt
  FROM ins
  CROSS JOIN (SELECT coalesce((SELECT count(*) FROM ims), 0) AS _force_ims) _x;

  RETURN coalesce(v_cnt, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_add_list_items(uuid, smallint, text[], uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.bulk_add_list_items(uuid, smallint, text[], uuid[]) TO authenticated;
