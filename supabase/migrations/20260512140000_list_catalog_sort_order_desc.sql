-- List card order: higher list_users.sort_order = nearer top; nulls last (bottom).
-- One-time invert preserves previous visual order. New creates/joins use max+1 (no bump-all).

-- -----------------------------------------------------------------------------
-- 1) Data: per user_id, rank by legacy ascending sort (nulls last), assign cnt - rn
-- -----------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    list_id,
    user_id,
    COUNT(*) OVER (PARTITION BY user_id) AS cnt,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY coalesce(sort_order, 2147483647), list_id::text
    ) AS rn
  FROM public.list_users
)
UPDATE public.list_users lu
SET sort_order = ranked.cnt - ranked.rn
FROM ranked
WHERE lu.list_id = ranked.list_id
  AND lu.user_id = ranked.user_id;

-- -----------------------------------------------------------------------------
-- 2) reorder_user_lists: first array entry = top = largest sort_order
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_user_lists(p_list_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*)::int
    INTO v_expected
  FROM public.list_users
  WHERE user_id = auth.uid();

  IF v_expected = 0 THEN
    RETURN;
  END IF;

  IF p_list_ids IS NULL OR coalesce(array_length(p_list_ids, 1), 0) <> v_expected THEN
    RAISE EXCEPTION 'List id list must include every user list exactly once';
  END IF;

  IF (SELECT count(distinct x.id) FROM unnest(p_list_ids) AS x(id)) <> v_expected THEN
    RAISE EXCEPTION 'Duplicate list ids';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_list_ids) u(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.list_users lu
      WHERE lu.list_id = u.id
        AND lu.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Invalid list id for current user';
  END IF;

  UPDATE public.list_users lu
  SET sort_order = v_expected - t.ord::int
  FROM unnest(p_list_ids) WITH ORDINALITY AS t(id, ord)
  WHERE lu.list_id = t.id
    AND lu.user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_user_lists(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.reorder_user_lists(uuid[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3) get_user_lists: JSON array order matches UI (high sort_order first; nulls last)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_lists()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN (
    SELECT coalesce(json_agg(x.row_json ORDER BY x.ord DESC NULLS LAST, x.ca DESC), '[]'::json)
    FROM (
      SELECT
        json_build_object(
          'id', l.id,
          'name', l.name,
          'owner_id', l.owner_id,
          'visibility', l.visibility,
          'archived', l.archived,
          'updated_at', l.updated_at,
          'client_created_at', l.client_created_at,
          'server_created_at', l.server_created_at,
          'deleted_at', l.deleted_at,
          'version', l.version,
          'last_synced_at', l.last_synced_at,
          'role', lu.role,
          'userArchived', lu.archived,
          'sort_order', lu.sort_order,
          'sumScope', lu.sum_scope,
          'ownerNickname', CASE
            WHEN lu.role <> 'owner' THEN (SELECT p.nickname FROM public.profiles p WHERE p.id = l.owner_id)
            ELSE NULL
          END,
          'comment', l.comment,
          'label', coalesce(lu.label, '')
        ) AS row_json,
        lu.sort_order AS ord,
        coalesce(l.server_created_at, l.client_created_at) AS ca
      FROM public.list_users lu
      JOIN public.lists l ON l.id = lu.list_id
      WHERE lu.user_id = auth.uid()
    ) x
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_lists() FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_lists() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) create_list: new membership sort_order = max others + 1
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_list(
  p_name text,
  p_label text DEFAULT '',
  p_id uuid DEFAULT NULL,
  p_client_created_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_final_name text;
  v_name_changed boolean;
  v_new_list public.lists%rowtype;
  v_client_created timestamptz := coalesce(p_client_created_at, now());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_trimmed_name = '' THEN
    RAISE EXCEPTION 'List name is required';
  END IF;

  v_final_name := public.resolve_unique_owner_list_name(v_user_id, v_trimmed_name, NULL);
  v_name_changed := lower(btrim(v_trimmed_name)) IS DISTINCT FROM lower(btrim(v_final_name));

  INSERT INTO public.lists (id, name, owner_id, client_created_at)
  VALUES (coalesce(p_id, gen_random_uuid()), v_final_name, v_user_id, v_client_created)
  RETURNING * INTO v_new_list;

  UPDATE public.list_users
  SET sort_order = (
      SELECT coalesce(max(lu2.sort_order), -1) + 1
      FROM public.list_users lu2
      WHERE lu2.user_id = v_user_id
        AND lu2.list_id != v_new_list.id
    ),
    label = coalesce(nullif(btrim(p_label), ''), '')
  WHERE list_id = v_new_list.id
    AND user_id = v_user_id;

  RETURN jsonb_build_object(
    'list', to_jsonb(v_new_list),
    'display_name_changed', v_name_changed,
    'requested_name', v_trimmed_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_list(text, text, uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.create_list(text, text, uuid, timestamptz) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5) join_list_by_token: joined list at top (max+1), no bump-all
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_list_by_token(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list_id uuid;
  v_role text;
  v_owner_id uuid;
  v_ts timestamptz := now();
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'Token is required';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT l.id, l.join_role_granted::text, l.owner_id
    INTO v_list_id, v_role, v_owner_id
  FROM public.lists l
  WHERE l.join_token IS NOT NULL
    AND l.join_revoked_at IS NULL
    AND (l.join_expires_at IS NULL OR l.join_expires_at > now())
    AND l.join_token = p_token
  LIMIT 1;

  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or revoked token';
  END IF;

  IF v_owner_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot join your own list';
  END IF;

  INSERT INTO public.list_users (
    list_id,
    user_id,
    role,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at
  )
  VALUES (
    v_list_id,
    auth.uid(),
    v_role,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL
  )
  ON CONFLICT (list_id, user_id) DO UPDATE
    SET role = excluded.role;

  UPDATE public.list_users
  SET sort_order = (
      SELECT coalesce(max(lu2.sort_order), -1) + 1
      FROM public.list_users lu2
      WHERE lu2.user_id = auth.uid()
        AND lu2.list_id != v_list_id
    )
  WHERE list_id = v_list_id
    AND user_id = auth.uid();

  UPDATE public.lists
  SET join_use_count = join_use_count + 1
  WHERE id = v_list_id;

  RETURN v_list_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_list_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_list_by_token(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) duplicate_list: list_users for new list = max+1 (items unchanged)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duplicate_list(
  p_source_list_id uuid,
  p_new_name text,
  p_label text DEFAULT '',
  p_id uuid DEFAULT NULL,
  p_item_ids uuid[] DEFAULT NULL,
  p_target_member_id uuid DEFAULT NULL,
  p_client_created_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_new_name, ''));
  v_new_list public.lists%rowtype;
  v_result jsonb;
  v_source_target_id uuid;
  v_new_target_id uuid;
  v_item_count int;
  v_ts timestamptz := coalesce(p_client_created_at, now());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_trimmed_name = '' THEN
    RAISE EXCEPTION 'List name is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users
    WHERE list_id = p_source_list_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT count(*)::int INTO v_item_count
  FROM public.items
  WHERE list_id = p_source_list_id;

  IF p_item_ids IS NOT NULL AND cardinality(p_item_ids) IS DISTINCT FROM v_item_count THEN
    RAISE EXCEPTION 'p_item_ids length must match source item count';
  END IF;

  INSERT INTO public.lists (id, name, owner_id, client_created_at)
  VALUES (coalesce(p_id, gen_random_uuid()), v_trimmed_name, v_user_id, v_ts)
  RETURNING * INTO v_new_list;

  INSERT INTO public.items (
    id,
    list_id,
    text,
    comment,
    archived,
    archived_at,
    sort_order,
    category,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at,
    updated_at
  )
  SELECT
    coalesce(
      CASE WHEN p_item_ids IS NULL THEN NULL ELSE p_item_ids[src.rn] END,
      gen_random_uuid()
    ),
    v_new_list.id,
    src.text,
    src.comment,
    src.archived,
    src.archived_at,
    src.sort_order,
    src.category,
    coalesce(src.client_created_at, src.server_created_at, v_ts),
    src.server_created_at,
    src.deleted_at,
    coalesce(src.version, 1)::bigint,
    src.last_synced_at,
    coalesce(src.updated_at, v_ts)
  FROM (
    SELECT
      i.*,
      row_number() OVER (
        ORDER BY i.archived, i.sort_order NULLS LAST, coalesce(i.server_created_at, i.client_created_at), i.id
      )::int AS rn
    FROM public.items i
    WHERE i.list_id = p_source_list_id
  ) src
  ORDER BY src.rn;

  UPDATE public.list_users
  SET sort_order = (
      SELECT coalesce(max(lu2.sort_order), -1) + 1
      FROM public.list_users lu2
      WHERE lu2.user_id = v_user_id
        AND lu2.list_id != v_new_list.id
    ),
    label = coalesce(nullif(btrim(p_label), ''), ''),
    item_text_width = 'auto'
  WHERE list_id = v_new_list.id
    AND user_id = v_user_id;

  SELECT m.id
    INTO v_source_target_id
  FROM public.members m
  WHERE m.list_id = p_source_list_id
    AND m.is_target = true
  LIMIT 1;

  IF v_source_target_id IS NOT NULL THEN
    INSERT INTO public.members (
      id,
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
    SELECT
      coalesce(p_target_member_id, gen_random_uuid()),
      v_new_list.id,
      m.name,
      v_user_id,
      0,
      false,
      true,
      v_ts,
      v_ts,
      NULL,
      1,
      NULL,
      v_ts
    FROM public.members m
    WHERE m.id = v_source_target_id
    RETURNING id INTO v_new_target_id;

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
      map.new_item_id,
      v_new_target_id,
      ims.quantity,
      ims.done,
      ims.assigned,
      now(),
      coalesce(ims.client_created_at, ims.server_created_at, v_ts),
      ims.server_created_at,
      ims.deleted_at,
      coalesce(ims.version, 1)::bigint,
      ims.last_synced_at
    FROM (
      SELECT o.id AS old_item_id, n.id AS new_item_id
      FROM (
        SELECT
          id,
          row_number() OVER (
            ORDER BY archived, sort_order NULLS LAST, coalesce(server_created_at, client_created_at), id
          ) AS rn
        FROM public.items
        WHERE list_id = p_source_list_id
      ) o
      JOIN (
        SELECT
          id,
          row_number() OVER (
            ORDER BY archived, sort_order NULLS LAST, coalesce(server_created_at, client_created_at), id
          ) AS rn
        FROM public.items
        WHERE list_id = v_new_list.id
      ) n USING (rn)
    ) map
    JOIN public.item_member_state ims
      ON ims.item_id = map.old_item_id
     AND ims.member_id = v_source_target_id;
  END IF;

  v_result := (SELECT get_list_data(v_new_list.id))::jsonb;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_list(uuid, text, text, uuid, uuid[], uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.duplicate_list(uuid, text, text, uuid, uuid[], uuid, timestamptz) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7) import_list: list_users for new list = max+1 (items unchanged)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_list(
  p_name text,
  p_label text DEFAULT '',
  p_category_names text DEFAULT NULL,
  p_rows jsonb DEFAULT '[]'::jsonb,
  p_has_targets boolean DEFAULT false,
  p_id uuid DEFAULT NULL,
  p_item_ids uuid[] DEFAULT NULL,
  p_client_created_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_new_list public.lists%rowtype;
  v_len int;
  v_target_member_id uuid;
  v_ts timestamptz := coalesce(p_client_created_at, now());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_trimmed_name = '' THEN
    RAISE EXCEPTION 'List name is required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  v_len := jsonb_array_length(p_rows);
  IF v_len > 2000 THEN
    RAISE EXCEPTION 'Too many rows (max 2000)';
  END IF;

  IF p_item_ids IS NOT NULL AND cardinality(p_item_ids) IS DISTINCT FROM v_len THEN
    RAISE EXCEPTION 'p_item_ids length must match p_rows length';
  END IF;

  INSERT INTO public.lists (id, name, owner_id, client_created_at)
  VALUES (coalesce(p_id, gen_random_uuid()), v_trimmed_name, v_user_id, v_ts)
  RETURNING * INTO v_new_list;

  IF p_category_names IS NOT NULL AND p_category_names <> '' AND p_category_names <> '{}' THEN
    UPDATE public.lists
    SET category_names = p_category_names
    WHERE id = v_new_list.id;
    v_new_list.category_names := p_category_names;
  END IF;

  IF coalesce(p_has_targets, false) THEN
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
      v_new_list.id,
      'Qty',
      v_user_id,
      0,
      false,
      true,
      v_ts,
      v_ts,
      NULL,
      1,
      NULL,
      v_ts
    )
    RETURNING id INTO v_target_member_id;
  END IF;

  IF v_len > 0 THEN
    INSERT INTO public.items (
      id,
      list_id,
      text,
      sort_order,
      category,
      comment,
      client_created_at,
      server_created_at,
      deleted_at,
      version,
      last_synced_at,
      updated_at
    )
    SELECT
      coalesce(
        CASE WHEN p_item_ids IS NULL THEN NULL ELSE p_item_ids[r.idx::int] END,
        gen_random_uuid()
      ),
      v_new_list.id,
      left(trim(r.elem->>'text'), 2000),
      coalesce((r.elem->>'sort_order')::integer, 0),
      least(greatest(coalesce((r.elem->>'category')::integer, 1), 1), 6)::smallint,
      nullif(left(trim(r.elem->>'comment'), 5000), ''),
      v_ts,
      v_ts,
      NULL,
      1,
      NULL,
      v_ts
    FROM jsonb_array_elements(p_rows) WITH ordinality AS r(elem, idx)
    WHERE length(trim(r.elem->>'text')) > 0;

    IF v_target_member_id IS NOT NULL THEN
      INSERT INTO public.item_member_state (
        item_id,
        member_id,
        quantity,
        done,
        assigned,
        client_created_at,
        server_created_at,
        deleted_at,
        version,
        last_synced_at,
        updated_at
      )
      SELECT
        i.id,
        v_target_member_id,
        1,
        false,
        true,
        v_ts,
        v_ts,
        NULL,
        1,
        NULL,
        v_ts
      FROM public.items i
      WHERE i.list_id = v_new_list.id;
    END IF;
  END IF;

  UPDATE public.list_users
  SET sort_order = (
      SELECT coalesce(max(lu2.sort_order), -1) + 1
      FROM public.list_users lu2
      WHERE lu2.user_id = v_user_id
        AND lu2.list_id != v_new_list.id
    ),
    label = coalesce(nullif(btrim(p_label), ''), ''),
    item_text_width = 'auto'
  WHERE list_id = v_new_list.id
    AND user_id = v_user_id;

  RETURN to_jsonb(v_new_list);
END;
$$;

REVOKE ALL ON FUNCTION public.import_list(text, text, text, jsonb, boolean, uuid, uuid[], timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.import_list(text, text, text, jsonb, boolean, uuid, uuid[], timestamptz) TO authenticated;
