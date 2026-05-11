-- Reorder all list cards for the current user in one call.
-- p_list_ids: every list id for auth.uid(), in desired visual order (index 0 = top of home).
-- Persists list_users.sort_order where higher = higher on home: first id gets (n-1), last gets 0.

CREATE OR REPLACE FUNCTION public.reorder_user_lists(p_list_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*)::int
    INTO v_expected
  FROM public.list_users
  WHERE user_id = auth.uid();

  IF v_expected = 0 THEN
    RETURN;
  END IF;

  IF p_list_ids IS NULL OR coalesce(array_length(p_list_ids, 1), 0) <> v_expected THEN
    RAISE EXCEPTION 'List id list must include every user list exactly once';
  END IF;

  IF (SELECT count(distinct x.id) FROM unnest(p_list_ids) AS x(id)) <> v_expected THEN
    RAISE EXCEPTION 'Duplicate list ids';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_list_ids) u(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.list_users lu
      WHERE lu.list_id = u.id
        AND lu.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Invalid list id for current user';
  END IF;

  UPDATE public.list_users lu
  SET sort_order = v_expected - t.ord::int
  FROM unnest(p_list_ids) WITH ORDINALITY AS t(id, ord)
  WHERE lu.list_id = t.id
    AND lu.user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_user_lists(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.reorder_user_lists(uuid[]) TO authenticated;
