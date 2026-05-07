-- Fix legacy created_at references after syncable-field migration.
-- get_user_lists must use server/client created timestamps.

DROP FUNCTION IF EXISTS public.get_user_lists();

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
    SELECT coalesce(json_agg(x.row_json ORDER BY x.ord NULLS LAST, x.ca DESC), '[]'::json)
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
          'memberCount', (
            SELECT count(*)::int
            FROM public.members m
            WHERE m.list_id = l.id
              AND NOT coalesce(m.is_target, false)
          ),
          'activeItemCount', (
            SELECT count(*)::int
            FROM public.items i
            WHERE i.list_id = l.id
              AND NOT i.archived
          ),
          'archivedItemCount', (
            SELECT count(*)::int
            FROM public.items i
            WHERE i.list_id = l.id
              AND i.archived
          ),
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

-- Keep list detail payload aligned with syncable timestamps.
DROP FUNCTION IF EXISTS public.get_list_data(uuid);

CREATE OR REPLACE FUNCTION public.get_list_data(p_list_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users
    WHERE list_id = p_list_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT json_build_object(
    'list', (SELECT row_to_json(l.*) FROM public.lists l WHERE l.id = p_list_id),
    'members', (
      SELECT coalesce(
        json_agg(
          json_build_object(
            'id', m.id,
            'list_id', m.list_id,
            'name', m.name,
            'created_by', m.created_by,
            'sort_order', m.sort_order,
            'client_created_at', m.client_created_at,
            'server_created_at', m.server_created_at,
            'deleted_at', m.deleted_at,
            'version', m.version,
            'last_synced_at', m.last_synced_at,
            'updated_at', m.updated_at,
            'is_public', m.is_public,
            'is_target', m.is_target,
            'creator', (
              SELECT json_build_object('nickname', p.nickname)
              FROM public.profiles p
              WHERE p.id = m.created_by
            )
          ) ORDER BY m.sort_order NULLS LAST, coalesce(m.server_created_at, m.client_created_at), m.id
        ),
        '[]'::json
      )
      FROM public.members m
      WHERE m.list_id = p_list_id
    ),
    'items', (
      SELECT coalesce(
        json_agg(
          json_build_object(
            'id', i.id,
            'list_id', i.list_id,
            'text', i.text,
            'comment', i.comment,
            'archived', i.archived,
            'archived_at', i.archived_at,
            'sort_order', i.sort_order,
            'category', i.category,
            'client_created_at', i.client_created_at,
            'server_created_at', i.server_created_at,
            'deleted_at', i.deleted_at,
            'version', i.version,
            'last_synced_at', i.last_synced_at,
            'updated_at', i.updated_at,
            'memberStates', (
              SELECT coalesce(json_object_agg(ims.member_id, row_to_json(ims.*)), '{}'::json)
              FROM public.item_member_state ims
              WHERE ims.item_id = i.id
            )
          ) ORDER BY i.sort_order NULLS LAST, coalesce(i.server_created_at, i.client_created_at), i.id
        ),
        '[]'::json
      )
      FROM public.items i
      WHERE i.list_id = p_list_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_list_data(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_list_data(uuid) TO authenticated;

-- Ensure duplicate_list also uses syncable timestamps and client-supplied IDs.
DROP FUNCTION IF EXISTS public.duplicate_list(uuid, text);
DROP FUNCTION IF EXISTS public.duplicate_list(uuid, text, text);
DROP FUNCTION IF EXISTS public.duplicate_list(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.duplicate_list(uuid, text, text, uuid, uuid[], uuid);

CREATE OR REPLACE FUNCTION public.duplicate_list(
  p_source_list_id uuid,
  p_new_name text,
  p_label text DEFAULT '',
  p_id uuid DEFAULT null,
  p_item_ids uuid[] DEFAULT null,
  p_target_member_id uuid DEFAULT null
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

  INSERT INTO public.lists (id, name, owner_id)
  VALUES (coalesce(p_id, gen_random_uuid()), v_trimmed_name, v_user_id)
  RETURNING * INTO v_new_list;

  INSERT INTO public.items (id, list_id, text, comment, archived, archived_at, sort_order, category)
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
    src.category
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
  SET sort_order = coalesce(sort_order, 0) + 1
  WHERE user_id = v_user_id
    AND list_id != v_new_list.id;

  UPDATE public.list_users
  SET sort_order = 0,
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
    INSERT INTO public.members (id, list_id, name, created_by, sort_order, is_public, is_target)
    SELECT
      coalesce(p_target_member_id, gen_random_uuid()),
      v_new_list.id,
      m.name,
      v_user_id,
      0,
      false,
      true
    FROM public.members m
    WHERE m.id = v_source_target_id
    RETURNING id INTO v_new_target_id;

    INSERT INTO public.item_member_state (item_id, member_id, quantity, done, assigned, updated_at)
    SELECT
      map.new_item_id,
      v_new_target_id,
      ims.quantity,
      ims.done,
      ims.assigned,
      now()
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

REVOKE ALL ON FUNCTION public.duplicate_list(uuid, text, text, uuid, uuid[], uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.duplicate_list(uuid, text, text, uuid, uuid[], uuid) TO authenticated;

