-- own_member: claim a public member slot by updating the row in place (same id).
-- Avoids delete+insert + item_member_state migration, fixes dual-member UI flicker, and keeps IMS keys stable.

CREATE OR REPLACE FUNCTION public.own_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_source public.members%rowtype;
  v_result jsonb;
  v_ts timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
    INTO v_source
  FROM public.members
  WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_source.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_source.created_by = v_user_id THEN
    RAISE EXCEPTION 'You already own this member';
  END IF;

  IF NOT v_source.is_public THEN
    RAISE EXCEPTION 'Member is not public';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users
    WHERE list_id = v_source.list_id
      AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.members
  SET
    created_by = v_user_id,
    is_public = false,
    updated_at = v_ts,
    version = COALESCE(version, 1) + 1,
    last_synced_at = NULL
  WHERE id = p_member_id;

  SELECT jsonb_build_object(
    'member',
    to_jsonb(m) || jsonb_build_object(
      'creator',
      (SELECT jsonb_build_object('nickname', p.nickname)
       FROM public.profiles p
       WHERE p.id = m.created_by)
    )
  )
  INTO v_result
  FROM public.members m
  WHERE m.id = p_member_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.own_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.own_member(uuid) TO authenticated;
