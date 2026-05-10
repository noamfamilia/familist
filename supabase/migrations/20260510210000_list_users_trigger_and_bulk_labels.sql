-- 1) add_list_owner_membership: list_users.client_created_at is NOT NULL after syncable_row_fields.
-- 2) join_list_by_token: same for invited members' list_users rows.
-- 3) bulk_update_list_labels: CTE "unauthorized" is not visible outside the WITH … UPDATE (42P01).

-- ---------------------------------------------------------------------------
-- Trigger: new list → owner row in list_users
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_list_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ts timestamptz := coalesce(NEW.client_created_at, now());
BEGIN
  INSERT INTO public.list_users (
    list_id,
    user_id,
    role,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at
  )
  VALUES (
    NEW.id,
    NEW.owner_id,
    'owner',
    v_ts,
    NEW.server_created_at,
    NULL,
    1,
    NULL
  )
  ON CONFLICT (list_id, user_id) DO UPDATE
    SET role = excluded.role;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- join_list_by_token
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_list_by_token(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list_id uuid;
  v_role text;
  v_owner_id uuid;
  v_ts timestamptz := now();
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'Token is required';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT l.id, l.join_role_granted::text, l.owner_id
    INTO v_list_id, v_role, v_owner_id
  FROM public.lists l
  WHERE l.join_token IS NOT NULL
    AND l.join_revoked_at IS NULL
    AND (l.join_expires_at IS NULL OR l.join_expires_at > now())
    AND l.join_token = p_token
  LIMIT 1;

  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or revoked token';
  END IF;

  IF v_owner_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot join your own list';
  END IF;

  INSERT INTO public.list_users (
    list_id,
    user_id,
    role,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at
  )
  VALUES (
    v_list_id,
    auth.uid(),
    v_role,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL
  )
  ON CONFLICT (list_id, user_id) DO UPDATE
    SET role = excluded.role;

  UPDATE public.list_users
  SET sort_order = coalesce(sort_order, 0) + 1
  WHERE user_id = auth.uid()
    AND list_id != v_list_id;

  UPDATE public.list_users
  SET sort_order = 0
  WHERE list_id = v_list_id
    AND user_id = auth.uid();

  UPDATE public.lists
  SET join_use_count = join_use_count + 1
  WHERE id = v_list_id;

  RETURN v_list_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_list_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_list_by_token(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- bulk_update_list_labels (CTE scope: "unauthorized" invalid outside WITH)
-- ---------------------------------------------------------------------------
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
