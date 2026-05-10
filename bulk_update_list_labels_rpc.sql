-- Bulk update labels for multiple lists that belong to the current user.
-- p_updates: jsonb array of objects: [{ "list_id": "<uuid>", "label": "<text>" }, ...]
-- NOTE: keep in sync with supabase/migrations/20260510210000_list_users_trigger_and_bulk_labels.sql

CREATE OR REPLACE FUNCTION public.bulk_update_list_labels(p_updates jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;

  WITH raw AS (
    SELECT
      nullif(trim(x->>'list_id'), '')::uuid AS list_id,
      coalesce(x->>'label', '') AS label
    FROM jsonb_array_elements(p_updates) AS x
  ),
  cleaned AS (
    SELECT DISTINCT list_id, left(label, 200) AS label
    FROM raw
    WHERE list_id IS NOT NULL
  ),
  unauthorized AS (
    SELECT c.list_id
    FROM cleaned c
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.list_users lu
      WHERE lu.list_id = c.list_id
        AND lu.user_id = v_user_id
    )
  )
  UPDATE public.list_users lu
  SET label = c.label
  FROM cleaned c
  WHERE lu.list_id = c.list_id
    AND lu.user_id = v_user_id
    AND NOT EXISTS (SELECT 1 FROM unauthorized);

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT nullif(trim(x->>'list_id'), '')::uuid AS list_id
      FROM jsonb_array_elements(p_updates) AS x
    ) r
    WHERE r.list_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.list_users lu
        WHERE lu.list_id = r.list_id
          AND lu.user_id = v_user_id
      )
  ) THEN
    RAISE EXCEPTION 'Invalid list id for current user';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_list_labels(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.bulk_update_list_labels(jsonb) TO authenticated;
