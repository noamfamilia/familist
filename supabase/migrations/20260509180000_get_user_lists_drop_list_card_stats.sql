-- Home catalog: lists + list_users only. Card counts come from Dexie (items/members) + liveQuery.
-- Drops list_card_stats and removes count fields from get_user_lists JSON.

DROP VIEW IF EXISTS public.list_card_stats;

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
