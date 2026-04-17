-- 1. Add neighbor snapshot columns to items
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS archived_above_id uuid REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS archived_below_id uuid REFERENCES public.items(id) ON DELETE SET NULL;

-- 2. Update get_list_data to include the new columns in item JSON
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
    SELECT 1 FROM public.list_users
    WHERE list_id = p_list_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT json_build_object(
    'list', (SELECT row_to_json(l.*) FROM public.lists l WHERE l.id = p_list_id),
    'members', (
      SELECT coalesce(json_agg(
        json_build_object(
          'id', m.id,
          'list_id', m.list_id,
          'name', m.name,
          'created_by', m.created_by,
          'sort_order', m.sort_order,
          'created_at', m.created_at,
          'updated_at', m.updated_at,
          'is_public', m.is_public,
          'is_target', m.is_target,
          'creator', (SELECT json_build_object('nickname', p.nickname) FROM public.profiles p WHERE p.id = m.created_by)
        ) ORDER BY m.sort_order NULLS LAST, m.created_at
      ), '[]'::json)
      FROM public.members m WHERE m.list_id = p_list_id
    ),
    'items', (
      SELECT coalesce(json_agg(
        json_build_object(
          'id', i.id,
          'list_id', i.list_id,
          'text', i.text,
          'comment', i.comment,
          'archived', i.archived,
          'archived_at', i.archived_at,
          'sort_order', i.sort_order,
          'category', i.category,
          'archived_above_id', i.archived_above_id,
          'archived_below_id', i.archived_below_id,
          'created_at', i.created_at,
          'updated_at', i.updated_at,
          'memberStates', (
            SELECT coalesce(json_object_agg(ims.member_id, row_to_json(ims.*)), '{}'::json)
            FROM public.item_member_state ims WHERE ims.item_id = i.id
          )
        ) ORDER BY i.sort_order NULLS LAST, i.created_at
      ), '[]'::json)
      FROM public.items i WHERE i.list_id = p_list_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_list_data(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_list_data(uuid) TO authenticated;

-- 3. Update restore_archived_items to use neighbor-based positioning
CREATE OR REPLACE FUNCTION public.restore_archived_items(p_list_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_max_sort int;
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

  SELECT coalesce(max(sort_order), -1)
  INTO v_max_sort
  FROM public.items
  WHERE list_id = p_list_id AND archived = false;

  -- Bulk restore: place at end of active items, clear neighbor refs
  WITH numbered AS (
    SELECT id, row_number() OVER (ORDER BY archived_at ASC NULLS LAST, created_at ASC) AS rn
    FROM public.items
    WHERE list_id = p_list_id AND archived = true
  )
  UPDATE public.items i
  SET archived = false,
      archived_at = NULL,
      sort_order = v_max_sort + n.rn,
      archived_above_id = NULL,
      archived_below_id = NULL
  FROM numbered n
  WHERE i.id = n.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_archived_items(uuid) TO authenticated;
