-- Keep list-card fields in get_user_lists, but move category config to get_list_data.
-- category_names/category_order should be read from get_list_data.list.
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
          'created_at', l.created_at,
          'updated_at', l.updated_at,
          'role', lu.role,
          'userArchived', lu.archived,
          'sort_order', lu.sort_order,
          'memberCount', (
            SELECT count(*)::int
            FROM public.members m
            WHERE m.list_id = l.id AND NOT coalesce(m.is_target, false)
          ),
          'activeItemCount', (
            SELECT count(*)::int
            FROM public.items i
            WHERE i.list_id = l.id AND NOT i.archived
          ),
          'archivedItemCount', (
            SELECT count(*)::int
            FROM public.items i
            WHERE i.list_id = l.id AND i.archived
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
        l.created_at AS ca
      FROM public.list_users lu
      JOIN public.lists l ON l.id = lu.list_id
      WHERE lu.user_id = auth.uid()
    ) x
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_lists() FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_lists() TO authenticated;
