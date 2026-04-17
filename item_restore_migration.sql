-- Unified sort_order: drop neighbor snapshot columns and update get_list_data RPC

-- 1. Drop the neighbor columns (no longer needed)
ALTER TABLE public.items DROP COLUMN IF EXISTS archived_above_id;
ALTER TABLE public.items DROP COLUMN IF EXISTS archived_below_id;

-- 2. Update get_list_data to remove the dropped columns from item JSON
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
