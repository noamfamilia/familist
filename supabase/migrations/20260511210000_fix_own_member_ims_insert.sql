-- Fix own_member: INSERT INTO item_member_state listed 11 columns but the SELECT had 12 expressions
-- (trailing duplicate v_ts), causing 42601 "INSERT has more expressions than target columns".

CREATE OR REPLACE FUNCTION public.own_member(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_source public.members%rowtype;
  v_new_id uuid;
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

  CREATE TEMPORARY TABLE IF NOT EXISTS _own_member_states (
    item_id uuid,
    quantity integer,
    done boolean,
    assigned boolean,
    updated_at timestamptz
  ) ON COMMIT DROP;

  TRUNCATE _own_member_states;

  INSERT INTO _own_member_states (item_id, quantity, done, assigned, updated_at)
  SELECT item_id, quantity, done, assigned, updated_at
  FROM public.item_member_state
  WHERE member_id = p_member_id;

  DELETE FROM public.members
  WHERE id = p_member_id;

  INSERT INTO public.members (
    list_id,
    name,
    created_by,
    sort_order,
    is_public,
    is_target,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at,
    updated_at
  )
  VALUES (
    v_source.list_id,
    v_source.name,
    v_user_id,
    CASE WHEN v_source.is_target THEN 0 ELSE v_source.sort_order END,
    false,
    v_source.is_target,
    v_ts,
    v_ts,
    NULL,
    1,
    NULL,
    v_ts
  )
  RETURNING id INTO v_new_id;

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
    s.item_id,
    v_new_id,
    s.quantity,
    s.done,
    s.assigned,
    v_ts,
    v_ts,
    v_ts,
    NULL,
    1,
    v_ts
  FROM _own_member_states s;

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
  WHERE m.id = v_new_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.own_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.own_member(uuid) TO authenticated;
