-- 1. Add is_target column to members
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS is_target boolean NOT NULL DEFAULT false;

-- Enforce at most one target member per list
CREATE UNIQUE INDEX IF NOT EXISTS members_list_target_unique ON public.members (list_id) WHERE is_target = true;

-- 2. Add show_targets preference to list_users
ALTER TABLE public.list_users ADD COLUMN IF NOT EXISTS show_targets boolean NOT NULL DEFAULT false;

-- 3. Update get_list_data to include is_target in the member JSON
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

-- 4. Update get_user_lists to exclude target members from memberCount
-- (Find and update the memberCount subquery to add WHERE NOT m.is_target)
-- You'll need to update this line in your get_user_lists RPC:
--   'memberCount', (select count(*) from public.members m where m.list_id = l.id AND NOT m.is_target),
