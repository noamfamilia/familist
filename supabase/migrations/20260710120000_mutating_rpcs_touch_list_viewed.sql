-- Fold last_viewed into content-mutating RPCs; add delete_item_sync + upsert_item_member_state_sync.

-- ---------------------------------------------------------------------------
-- upsert_item_sync
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_item_sync(p_item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_list_id uuid;
  v_row jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_list_id := nullif(trim(p_item->>'list_id'), '')::uuid;
  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'p_item.list_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users lu
    WHERE lu.list_id = v_list_id
      AND lu.user_id = v_user_id
      AND lu.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_row := public.upsert_item_sync_row(p_item);
  PERFORM public.touch_list_viewed(v_list_id);

  RETURN jsonb_build_object(
    'item', v_row->'item',
    'display_name_changed', v_row->'display_name_changed',
    'requested_text', v_row->'requested_text'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- bulk_upsert_items_sync
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_upsert_items_sync(p_list_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_elem jsonb;
  v_item_list_id uuid;
  v_id uuid;
  v_row jsonb;
  v_len int;
  v_cnt int := 0;
  v_changes jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_list_id IS NULL THEN
    RAISE EXCEPTION 'p_list_id is required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  v_len := jsonb_array_length(p_items);
  IF v_len > 500 THEN
    RAISE EXCEPTION 'Too many items (max 500)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users lu
    WHERE lu.list_id = p_list_id
      AND lu.user_id = v_user_id
      AND lu.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_items) AS t(value)
  LOOP
    v_id := nullif(trim(v_elem->>'id'), '')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'each item needs id';
    END IF;

    v_item_list_id := nullif(trim(v_elem->>'list_id'), '')::uuid;
    IF v_item_list_id IS NULL THEN
      v_elem := v_elem || jsonb_build_object('list_id', p_list_id::text);
    ELSIF v_item_list_id IS DISTINCT FROM p_list_id THEN
      RAISE EXCEPTION 'item list_id must match p_list_id';
    END IF;

    v_row := public.upsert_item_sync_row(v_elem);

    v_cnt := v_cnt + 1;
    IF coalesce((v_row->>'display_name_changed')::boolean, false) THEN
      v_changes := v_changes || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_id,
          'requested_text', v_row->>'requested_text',
          'text', v_row->>'text'
        )
      );
    END IF;
  END LOOP;

  PERFORM public.touch_list_viewed(p_list_id);

  RETURN jsonb_build_object(
    'inserted_count', v_cnt,
    'line_text_changes', v_changes
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- bulk_add_list_items
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_add_list_items(
  p_list_id uuid,
  p_category smallint,
  p_lines text[],
  p_item_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_target_id uuid;
  v_cat smallint;
  v_in_len int;
  v_ts timestamptz := now();
  rec record;
  v_req text;
  v_final text;
  v_changed boolean;
  v_item_id uuid;
  v_mx int;
  v_rn int := 0;
  v_cnt int := 0;
  v_changes jsonb := '[]'::jsonb;
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

  SELECT coalesce(max(sort_order), -1)
    INTO v_mx
  FROM public.items
  WHERE list_id = p_list_id;

  FOR rec IN
    SELECT
      trim(x.l) AS t,
      x.ord::int AS src_ord
    FROM unnest(p_lines) WITH ORDINALITY AS x(l, ord)
    WHERE length(trim(x.l)) > 0
  LOOP
    v_req := left(rec.t, 2000);
    IF p_item_ids IS NULL THEN
      v_item_id := gen_random_uuid();
    ELSE
      v_item_id := p_item_ids[rec.src_ord];
    END IF;

    v_final := public.resolve_unique_item_text_for_list(p_list_id, v_req, v_item_id);
    v_changed := v_req IS DISTINCT FROM v_final;
    v_rn := v_rn + 1;

    INSERT INTO public.items (
      id, list_id, text, sort_order, category, archived, archived_at,
      client_created_at, server_created_at, deleted_at, version, last_synced_at, updated_at
    )
    VALUES (
      v_item_id, p_list_id, v_final, v_mx + v_rn, v_cat, false, NULL,
      v_ts, v_ts, NULL, 1, NULL, v_ts
    );

    IF v_target_id IS NOT NULL THEN
      INSERT INTO public.item_member_state (
        item_id, member_id, quantity, done, assigned, updated_at,
        client_created_at, server_created_at, deleted_at, version, last_synced_at
      )
      VALUES (
        v_item_id, v_target_id, 1, false, true, v_ts,
        v_ts, v_ts, NULL, 1, NULL
      );
    END IF;

    v_cnt := v_cnt + 1;
    IF v_changed THEN
      v_changes := v_changes || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item_id,
          'requested_text', v_req,
          'text', v_final
        )
      );
    END IF;
  END LOOP;

  PERFORM public.touch_list_viewed(p_list_id);

  RETURN jsonb_build_object(
    'inserted_count', v_cnt,
    'line_text_changes', v_changes
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- apply_item_patch_sync
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_item_patch_sync(p_item_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.items%rowtype;
  v_list_id uuid;
  v_req text;
  v_final text;
  v_text_changed boolean := false;
  v_comment text;
  v_cat smallint;
  v_archived boolean;
  v_archived_at timestamptz;
  v_sort_order integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'p_patch must be a JSON object';
  END IF;

  SELECT * INTO v_item FROM public.items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;
  v_list_id := v_item.list_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users lu
    WHERE lu.list_id = v_list_id
      AND lu.user_id = v_uid
      AND lu.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_patch ? 'text' THEN
    v_req := left(btrim(coalesce(p_patch->>'text', '')), 2000);
    IF v_req = '' THEN
      RAISE EXCEPTION 'Item text cannot be empty';
    END IF;
    v_final := public.resolve_unique_item_text_for_list(v_list_id, v_req, p_item_id);
    v_text_changed := lower(btrim(v_req)) IS DISTINCT FROM lower(btrim(v_final));
  ELSE
    v_final := v_item.text;
  END IF;

  v_comment := v_item.comment;
  IF p_patch ? 'comment' THEN
    v_comment := nullif(left(btrim(coalesce(p_patch->>'comment', '')), 5000), '');
  END IF;

  v_cat := v_item.category;
  IF p_patch ? 'category' THEN
    v_cat := least(greatest(coalesce((p_patch->>'category')::integer, 1), 1), 6)::smallint;
  END IF;

  v_archived := v_item.archived;
  IF p_patch ? 'archived' THEN
    v_archived := coalesce((p_patch->>'archived')::boolean, v_item.archived);
  END IF;

  v_archived_at := v_item.archived_at;
  IF p_patch ? 'archived_at' THEN
    v_archived_at := (p_patch->>'archived_at')::timestamptz;
  END IF;

  v_sort_order := v_item.sort_order;
  IF p_patch ? 'sort_order' AND jsonb_typeof(p_patch->'sort_order') <> 'null' AND (p_patch->>'sort_order') <> '' THEN
    v_sort_order := (p_patch->>'sort_order')::integer;
  END IF;

  UPDATE public.items
  SET
    text = v_final,
    comment = v_comment,
    category = v_cat,
    archived = v_archived,
    archived_at = v_archived_at,
    sort_order = v_sort_order,
    updated_at = now()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  PERFORM public.touch_list_viewed(v_list_id);

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item),
    'display_name_changed', v_text_changed,
    'requested_text', CASE WHEN p_patch ? 'text' THEN v_req ELSE NULL END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- upsert_member_sync
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_member_sync(p_member jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_list_id uuid;
  v_req text;
  v_final text;
  v_changed boolean;
  v_row public.members%rowtype;
  v_created_by uuid;
  v_sort_order integer;
  v_is_public boolean;
  v_is_target boolean;
  v_client_created timestamptz;
  v_server_created timestamptz;
  v_deleted_at timestamptz;
  v_version bigint;
  v_last_synced timestamptz;
  v_updated timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_member IS NULL OR jsonb_typeof(p_member) <> 'object' THEN
    RAISE EXCEPTION 'p_member must be a JSON object';
  END IF;

  v_id := nullif(trim(p_member->>'id'), '')::uuid;
  v_list_id := nullif(trim(p_member->>'list_id'), '')::uuid;
  IF v_id IS NULL OR v_list_id IS NULL THEN
    RAISE EXCEPTION 'p_member.id and p_member.list_id are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users lu
    WHERE lu.list_id = v_list_id
      AND lu.user_id = v_uid
      AND lu.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_req := left(btrim(coalesce(p_member->>'name', '')), 2000);
  IF v_req = '' THEN
    RAISE EXCEPTION 'Member name cannot be empty';
  END IF;
  v_final := public.resolve_unique_member_name_for_list(v_list_id, v_req, v_id);
  v_changed := lower(btrim(v_req)) IS DISTINCT FROM lower(btrim(v_final));

  v_created_by := nullif(trim(p_member->>'created_by'), '')::uuid;
  v_sort_order := CASE
    WHEN p_member ? 'sort_order' AND jsonb_typeof(p_member->'sort_order') <> 'null' AND (p_member->>'sort_order') <> ''
      THEN (p_member->>'sort_order')::integer
    ELSE NULL
  END;
  v_is_public := coalesce((p_member->>'is_public')::boolean, false);
  v_is_target := coalesce((p_member->>'is_target')::boolean, false);
  v_client_created := coalesce((p_member->>'client_created_at')::timestamptz, now());
  v_server_created := coalesce((p_member->>'server_created_at')::timestamptz, v_client_created);
  v_deleted_at := (p_member->>'deleted_at')::timestamptz;
  v_version := coalesce((p_member->>'version')::bigint, 1);
  v_last_synced := (p_member->>'last_synced_at')::timestamptz;
  v_updated := coalesce((p_member->>'updated_at')::timestamptz, v_client_created);

  INSERT INTO public.members (
    id, list_id, name, created_by, sort_order, is_public, is_target,
    client_created_at, server_created_at, deleted_at, version, last_synced_at, updated_at
  )
  VALUES (
    v_id, v_list_id, v_final, v_created_by, v_sort_order, v_is_public, v_is_target,
    v_client_created, v_server_created, v_deleted_at, v_version, v_last_synced, v_updated
  )
  ON CONFLICT (id) DO UPDATE SET
    list_id = excluded.list_id,
    name = excluded.name,
    created_by = excluded.created_by,
    sort_order = excluded.sort_order,
    is_public = excluded.is_public,
    is_target = excluded.is_target,
    client_created_at = excluded.client_created_at,
    server_created_at = excluded.server_created_at,
    deleted_at = excluded.deleted_at,
    version = excluded.version,
    last_synced_at = excluded.last_synced_at,
    updated_at = excluded.updated_at
  RETURNING * INTO v_row;

  PERFORM public.touch_list_viewed(v_list_id);

  RETURN jsonb_build_object(
    'member', to_jsonb(v_row),
    'display_name_changed', v_changed,
    'requested_name', v_req
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- update_member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_member(
  p_member_id uuid,
  p_name text DEFAULT NULL::text,
  p_is_public boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.members%rowtype;
  v_list_id uuid;
  v_req text;
  v_final text;
  v_name_changed boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.members
    WHERE id = p_member_id
      AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the creator can edit this member';
  END IF;

  SELECT list_id INTO v_list_id
  FROM public.members
  WHERE id = p_member_id;

  IF p_name IS NOT NULL THEN
    v_req := left(btrim(p_name), 2000);
    IF v_req = '' THEN
      RAISE EXCEPTION 'Member name cannot be empty';
    END IF;
    v_final := public.resolve_unique_member_name_for_list(v_list_id, v_req, p_member_id);
    v_name_changed := lower(btrim(v_req)) IS DISTINCT FROM lower(btrim(v_final));
  ELSE
    v_final := NULL;
  END IF;

  UPDATE public.members
  SET
    name = CASE WHEN p_name IS NOT NULL THEN v_final ELSE name END,
    is_public = coalesce(p_is_public, is_public),
    updated_at = now()
  WHERE id = p_member_id
  RETURNING * INTO v_row;

  PERFORM public.touch_list_viewed(v_list_id);

  RETURN jsonb_build_object(
    'member', to_jsonb(v_row),
    'display_name_changed', v_name_changed,
    'requested_name', p_name
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_list_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT list_id INTO v_list_id
  FROM public.members
  WHERE id = p_member_id AND created_by = auth.uid();

  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'Only the creator can delete this member';
  END IF;

  DELETE FROM public.members WHERE id = p_member_id;
  PERFORM public.touch_list_viewed(v_list_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- own_member
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.own_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_source public.members%rowtype;
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

  IF v_source.deleted_at IS NOT NULL THEN
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

  UPDATE public.members
  SET
    created_by = v_user_id,
    is_public = false,
    updated_at = v_ts,
    version = COALESCE(version, 1) + 1,
    last_synced_at = NULL
  WHERE id = p_member_id;

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
  WHERE m.id = p_member_id;

  PERFORM public.touch_list_viewed(v_source.list_id);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_archived_items / restore_archived_items / reorder_list_items
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_archived_items(p_list_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.list_users
    WHERE list_id = p_list_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM public.items
  WHERE list_id = p_list_id AND archived = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.touch_list_viewed(p_list_id);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_archived_items(p_list_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.list_users
    WHERE list_id = p_list_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.items
  SET archived = false,
      archived_at = null
  WHERE list_id = p_list_id AND archived = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.touch_list_viewed(p_list_id);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_list_items(p_list_id uuid, p_item_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expected int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.list_users
    WHERE list_id = p_list_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT count(*)::int INTO v_expected FROM public.items WHERE list_id = p_list_id;

  IF v_expected = 0 THEN
    PERFORM public.touch_list_viewed(p_list_id);
    RETURN;
  END IF;

  IF p_item_ids IS NULL OR coalesce(array_length(p_item_ids, 1), 0) <> v_expected THEN
    RAISE EXCEPTION 'Item id list must include every item in the list exactly once';
  END IF;

  IF (SELECT count(distinct x.id) FROM unnest(p_item_ids) AS x(id)) <> v_expected THEN
    RAISE EXCEPTION 'Duplicate item ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_item_ids) u(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.items i WHERE i.id = u.id AND i.list_id = p_list_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid item id for this list';
  END IF;

  UPDATE public.items i
  SET sort_order = t.ord::int - 1,
      updated_at = now()
  FROM unnest(p_item_ids) WITH ORDINALITY AS t(id, ord)
  WHERE i.id = t.id AND i.list_id = p_list_id;

  PERFORM public.touch_list_viewed(p_list_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- NEW: delete_item_sync (replaces PostgREST items.delete for outbound)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_item_sync(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_list_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT list_id INTO v_list_id
  FROM public.items
  WHERE id = p_item_id;

  IF v_list_id IS NULL THEN
    -- Idempotent: already gone
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users lu
    WHERE lu.list_id = v_list_id
      AND lu.user_id = v_uid
      AND lu.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.items WHERE id = p_item_id;
  PERFORM public.touch_list_viewed(v_list_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_item_sync(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_item_sync(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- NEW: upsert_item_member_state_sync (replaces PostgREST IMS upsert)
-- Mirrors RLS: list member + (own member or public member).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_item_member_state_sync(
  p_item_id uuid,
  p_member_id uuid,
  p_quantity integer DEFAULT 1,
  p_done boolean DEFAULT false,
  p_assigned boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_list_id uuid;
  v_ts timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT i.list_id INTO v_list_id
  FROM public.items i
  WHERE i.id = p_item_id;

  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.members m
    JOIN public.list_users lu ON lu.list_id = m.list_id
    WHERE m.id = p_member_id
      AND m.list_id = v_list_id
      AND lu.user_id = v_uid
      AND (m.created_by = v_uid OR m.is_public = true)
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
    greatest(coalesce(p_quantity, 1), 1),
    coalesce(p_done, false),
    coalesce(p_assigned, false),
    v_ts,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL
  )
  ON CONFLICT (item_id, member_id) DO UPDATE SET
    quantity = excluded.quantity,
    done = excluded.done,
    assigned = excluded.assigned,
    updated_at = excluded.updated_at,
    deleted_at = NULL;

  PERFORM public.touch_list_viewed(v_list_id);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_item_member_state_sync(uuid, uuid, integer, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_item_member_state_sync(uuid, uuid, integer, boolean, boolean) TO authenticated;
