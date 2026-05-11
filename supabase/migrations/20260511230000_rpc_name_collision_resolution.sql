-- Server-side display-name dedupe for list/item creates + structured RPC responses
-- so the client can toast and align Dexie when the stored name differs from the request.

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_unique_owner_list_name(
  p_owner_id uuid,
  p_desired text,
  p_exclude_list_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_base text := left(btrim(coalesce(p_desired, '')), 2000);
  v_try text;
  v_n int := 0;
  v_max int := 120;
BEGIN
  IF v_base = '' THEN
    RETURN v_base;
  END IF;

  v_try := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.lists l
      WHERE l.owner_id = p_owner_id
        AND l.deleted_at IS NULL
        AND (p_exclude_list_id IS NULL OR l.id <> p_exclude_list_id)
        AND lower(btrim(l.name)) = lower(btrim(v_try))
    );

    v_n := v_n + 1;
    IF v_n >= v_max THEN
      RETURN left(v_base || ' (' || extract(epoch from clock_timestamp())::bigint::text || ')', 2000);
    END IF;

    IF v_n = 1 THEN
      v_try := v_base || ' (copy)';
    ELSE
      v_try := v_base || ' (copy ' || v_n::text || ')';
    END IF;
  END LOOP;

  RETURN left(v_try, 2000);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_unique_item_text_for_list(
  p_list_id uuid,
  p_desired text,
  p_exclude_item_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_base text := left(btrim(coalesce(p_desired, '')), 2000);
  v_try text;
  v_n int := 0;
  v_max int := 120;
BEGIN
  IF v_base = '' THEN
    RETURN v_base;
  END IF;

  v_try := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.items i
      WHERE i.list_id = p_list_id
        AND i.deleted_at IS NULL
        AND (p_exclude_item_id IS NULL OR i.id <> p_exclude_item_id)
        AND lower(btrim(i.text)) = lower(btrim(v_try))
    );

    v_n := v_n + 1;
    IF v_n >= v_max THEN
      RETURN left(v_base || ' (' || extract(epoch from clock_timestamp())::bigint::text || ')', 2000);
    END IF;

    IF v_n = 1 THEN
      v_try := v_base || ' (copy)';
    ELSE
      v_try := v_base || ' (copy ' || v_n::text || ')';
    END IF;
  END LOOP;

  RETURN left(v_try, 2000);
END;
$$;

-- -----------------------------------------------------------------------------
-- create_list → jsonb envelope { list, display_name_changed, requested_name }
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_list(text, text);
DROP FUNCTION IF EXISTS public.create_list(text, text, uuid);
DROP FUNCTION IF EXISTS public.create_list(text, text, uuid, timestamptz);

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
  SET sort_order = coalesce(sort_order, 0) + 1
  WHERE user_id = v_user_id
    AND list_id != v_new_list.id;

  UPDATE public.list_users
  SET sort_order = 0,
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
-- upsert_item_sync — replaces PostgREST upsert for outbound item creates; text dedupe
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_item_sync(p_item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'p_item must be a JSON object';
  END IF;

  v_id := nullif(trim(p_item->>'id'), '')::uuid;
  v_list_id := nullif(trim(p_item->>'list_id'), '')::uuid;
  IF v_id IS NULL OR v_list_id IS NULL THEN
    RAISE EXCEPTION 'p_item.id and p_item.list_id are required';
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
    'requested_text', v_req
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_item_sync(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_item_sync(jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- bulk_add_list_items → jsonb { inserted_count, line_text_changes: [...] }
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.bulk_add_list_items(uuid, smallint, text[]);
DROP FUNCTION IF EXISTS public.bulk_add_list_items(uuid, smallint, text[], uuid[]);

CREATE OR REPLACE FUNCTION public.bulk_add_list_items(
  p_list_id uuid,
  p_category smallint,
  p_lines text[],
  p_item_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    VALUES (
      v_item_id,
      p_list_id,
      v_final,
      v_mx + v_rn,
      v_cat,
      false,
      NULL,
      v_ts,
      v_ts,
      NULL,
      1,
      NULL,
      v_ts
    );

    IF v_target_id IS NOT NULL THEN
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
        v_item_id,
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

  RETURN jsonb_build_object(
    'inserted_count', v_cnt,
    'line_text_changes', v_changes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_add_list_items(uuid, smallint, text[], uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.bulk_add_list_items(uuid, smallint, text[], uuid[]) TO authenticated;
