-- Bulk-insert default item_member_state rows for a member (e.g. Qty target column).
-- Idempotent: skips existing (item_id, member_id) pairs.

CREATE OR REPLACE FUNCTION public.seed_item_member_state_for_member(
  p_list_id uuid,
  p_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted bigint := 0;
  v_ts timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users lu
    WHERE lu.list_id = p_list_id
      AND lu.user_id = v_uid
      AND lu.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.members m
    WHERE m.id = p_member_id
      AND m.list_id = p_list_id
      AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Member not found for list';
  END IF;

  INSERT INTO public.item_member_state (
    item_id,
    member_id,
    quantity,
    done,
    assigned,
    updated_at,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at
  )
  SELECT
    i.id,
    p_member_id,
    1,
    false,
    true,
    v_ts,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL
  FROM public.items i
  WHERE i.list_id = p_list_id
    AND i.deleted_at IS NULL
  ON CONFLICT (item_id, member_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.seed_item_member_state_for_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.seed_item_member_state_for_member(uuid, uuid) TO authenticated;
