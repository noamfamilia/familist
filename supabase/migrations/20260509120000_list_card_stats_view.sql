-- Aggregated per-list counts for home list cards (member / active items / archived items).
-- Used by get_user_lists; logic matches the previous inline subqueries (targets excluded from members).

CREATE OR REPLACE VIEW public.list_card_stats AS
SELECT
  l.id AS list_id,
  coalesce(mc.cnt, 0)::int AS member_count,
  coalesce(ai.cnt, 0)::int AS active_item_count,
  coalesce(ar.cnt, 0)::int AS archived_item_count
FROM public.lists l
LEFT JOIN (
  SELECT list_id, count(*)::int AS cnt
  FROM public.members
  WHERE NOT coalesce(is_target, false)
  GROUP BY list_id
) mc ON mc.list_id = l.id
LEFT JOIN (
  SELECT list_id, count(*)::int AS cnt
  FROM public.items
  WHERE NOT archived
  GROUP BY list_id
) ai ON ai.list_id = l.id
LEFT JOIN (
  SELECT list_id, count(*)::int AS cnt
  FROM public.items
  WHERE archived
  GROUP BY list_id
) ar ON ar.list_id = l.id;

COMMENT ON VIEW public.list_card_stats IS
  'Per-list counts for list cards: members excluding targets, non-archived items, archived items.';

-- Not exposed to PostgREST clients; only SECURITY DEFINER RPCs should read this.
REVOKE ALL ON TABLE public.list_card_stats FROM PUBLIC;

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
          'memberCount', coalesce(s.member_count, 0),
          'activeItemCount', coalesce(s.active_item_count, 0),
          'archivedItemCount', coalesce(s.archived_item_count, 0),
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
      LEFT JOIN public.list_card_stats s ON s.list_id = l.id
      WHERE lu.user_id = auth.uid()
    ) x
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_lists() FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_lists() TO authenticated;
