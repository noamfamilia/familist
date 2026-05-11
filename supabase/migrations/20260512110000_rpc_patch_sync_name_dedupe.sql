-- Dedupe display names on patch/sync for list rename, item text patch, member create/update.
-- Depends on: resolve_unique_owner_list_name, resolve_unique_item_text_for_list (20260511230000).

-- -----------------------------------------------------------------------------
-- Member name uniqueness within a list (non–soft-deleted members only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_unique_member_name_for_list(
  p_list_id uuid,
  p_desired text,
  p_exclude_member_id uuid DEFAULT NULL
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
      FROM public.members m
      WHERE m.list_id = p_list_id
        AND m.deleted_at IS NULL
        AND (p_exclude_member_id IS NULL OR m.id <> p_exclude_member_id)
        AND lower(btrim(m.name)) = lower(btrim(v_try))
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
-- update_member → jsonb { member, display_name_changed, requested_name }
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_member(uuid);
DROP FUNCTION IF EXISTS public.update_member(uuid, text);
DROP FUNCTION IF EXISTS public.update_member(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.update_member(
  p_member_id uuid,
  p_name text DEFAULT NULL,
  p_is_public boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  RETURN jsonb_build_object(
    'member', to_jsonb(v_row),
    'display_name_changed', v_name_changed,
    'requested_name', p_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_member(uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.update_member(uuid, text, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- apply_item_patch_sync — whitelist patch keys; dedupe `text`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_item_patch_sync(p_item_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item),
    'display_name_changed', v_text_changed,
    'requested_text', CASE WHEN p_patch ? 'text' THEN v_req ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_item_patch_sync(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_item_patch_sync(uuid, jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- apply_list_patch_sync — whitelist; dedupe `name` per owner
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_list_patch_sync(p_list_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_list public.lists%rowtype;
  v_owner uuid;
  v_req text;
  v_final text;
  v_name_changed boolean := false;
  v_comment text;
  v_archived boolean;
  v_cat_names text;
  v_cat_order text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'p_patch must be a JSON object';
  END IF;

  SELECT * INTO v_list FROM public.lists WHERE id = p_list_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  v_owner := v_list.owner_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users lu
    WHERE lu.list_id = p_list_id
      AND lu.user_id = v_uid
      AND lu.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_patch ? 'name' THEN
    v_req := left(btrim(coalesce(p_patch->>'name', '')), 2000);
    IF v_req = '' THEN
      RAISE EXCEPTION 'List name cannot be empty';
    END IF;
    v_final := public.resolve_unique_owner_list_name(v_owner, v_req, p_list_id);
    v_name_changed := lower(btrim(v_req)) IS DISTINCT FROM lower(btrim(v_final));
  ELSE
    v_final := v_list.name;
  END IF;

  v_comment := v_list.comment;
  IF p_patch ? 'comment' THEN
    v_comment := nullif(left(btrim(coalesce(p_patch->>'comment', '')), 5000), '');
  END IF;

  v_archived := v_list.archived;
  IF p_patch ? 'archived' THEN
    v_archived := coalesce((p_patch->>'archived')::boolean, v_list.archived);
  END IF;

  v_cat_names := v_list.category_names;
  IF p_patch ? 'category_names' THEN
    v_cat_names := p_patch->>'category_names';
  END IF;

  v_cat_order := v_list.category_order;
  IF p_patch ? 'category_order' THEN
    v_cat_order := p_patch->>'category_order';
  END IF;

  UPDATE public.lists
  SET
    name = v_final,
    comment = v_comment,
    archived = v_archived,
    category_names = v_cat_names,
    category_order = v_cat_order,
    updated_at = now()
  WHERE id = p_list_id
  RETURNING * INTO v_list;

  RETURN jsonb_build_object(
    'list', to_jsonb(v_list),
    'display_name_changed', v_name_changed,
    'requested_name', CASE WHEN p_patch ? 'name' THEN v_req ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_list_patch_sync(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_list_patch_sync(uuid, jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- upsert_member_sync — replaces PostgREST member upsert for outbound creates
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_member_sync(p_member jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  VALUES (
    v_id,
    v_list_id,
    v_final,
    v_created_by,
    v_sort_order,
    v_is_public,
    v_is_target,
    v_client_created,
    v_server_created,
    v_deleted_at,
    v_version,
    v_last_synced,
    v_updated
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

  RETURN jsonb_build_object(
    'member', to_jsonb(v_row),
    'display_name_changed', v_changed,
    'requested_name', v_req
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_member_sync(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_member_sync(jsonb) TO authenticated;
