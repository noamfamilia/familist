-- One RPC for duplicate-style bulk item sync (replaces N × upsert_item_sync).
-- Same per-row semantics: client UUIDs, full fields, resolve_unique_item_text_for_list.

CREATE OR REPLACE FUNCTION public.upsert_item_sync_row(p_item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_list_id uuid;
  v_req text;
  v_final text;
  v_changed boolean;
  v_row public.items%rowtype;
  v_comment text;
  v_archived boolean;
  v_archived_at timestamptz;
  v_sort_order integer;
  v_category smallint;
  v_client_created timestamptz;
  v_server_created timestamptz;
  v_deleted_at timestamptz;
  v_version bigint;
  v_last_synced timestamptz;
  v_updated timestamptz;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'p_item must be a JSON object';
  END IF;

  v_id := nullif(trim(p_item->>'id'), '')::uuid;
  v_list_id := nullif(trim(p_item->>'list_id'), '')::uuid;
  IF v_id IS NULL OR v_list_id IS NULL THEN
    RAISE EXCEPTION 'p_item.id and p_item.list_id are required';
  END IF;

  v_req := left(btrim(coalesce(p_item->>'text', '')), 2000);
  v_final := public.resolve_unique_item_text_for_list(v_list_id, v_req, v_id);
  v_changed := v_req IS DISTINCT FROM v_final;

  v_comment := nullif(left(btrim(coalesce(p_item->>'comment', '')), 5000), '');
  v_archived := coalesce((p_item->>'archived')::boolean, false);
  v_archived_at := (p_item->>'archived_at')::timestamptz;
  IF p_item ? 'sort_order' AND jsonb_typeof(p_item->'sort_order') <> 'null' AND (p_item->>'sort_order') <> '' THEN
    v_sort_order := (p_item->>'sort_order')::integer;
  ELSE
    v_sort_order := NULL;
  END IF;
  v_category := least(greatest(coalesce((p_item->>'category')::integer, 1), 1), 6)::smallint;
  v_client_created := coalesce((p_item->>'client_created_at')::timestamptz, now());
  v_server_created := coalesce((p_item->>'server_created_at')::timestamptz, v_client_created);
  v_deleted_at := (p_item->>'deleted_at')::timestamptz;
  v_version := coalesce((p_item->>'version')::bigint, 1);
  v_last_synced := (p_item->>'last_synced_at')::timestamptz;
  v_updated := coalesce((p_item->>'updated_at')::timestamptz, v_client_created);

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
  VALUES (
    v_id,
    v_list_id,
    v_final,
    v_comment,
    v_archived,
    v_archived_at,
    v_sort_order,
    v_category,
    v_client_created,
    v_server_created,
    v_deleted_at,
    v_version,
    v_last_synced,
    v_updated
  )
  ON CONFLICT (id) DO UPDATE SET
    list_id = excluded.list_id,
    text = excluded.text,
    comment = excluded.comment,
    archived = excluded.archived,
    archived_at = excluded.archived_at,
    sort_order = excluded.sort_order,
    category = excluded.category,
    client_created_at = excluded.client_created_at,
    server_created_at = excluded.server_created_at,
    deleted_at = excluded.deleted_at,
    version = excluded.version,
    last_synced_at = excluded.last_synced_at,
    updated_at = excluded.updated_at
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'item', to_jsonb(v_row),
    'display_name_changed', v_changed,
    'requested_text', v_req,
    'text', v_final
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_item_sync(p_item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  RETURN jsonb_build_object(
    'item', v_row->'item',
    'display_name_changed', v_row->'display_name_changed',
    'requested_text', v_row->'requested_text'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_upsert_items_sync(
  p_list_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  RETURN jsonb_build_object(
    'inserted_count', v_cnt,
    'line_text_changes', v_changes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_item_sync_row(jsonb) FROM public;
REVOKE ALL ON FUNCTION public.bulk_upsert_items_sync(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_items_sync(uuid, jsonb) TO authenticated;
