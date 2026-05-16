-- Local-first list duplicate: extended create_list + bulk_add_states for members/IMS.

DROP FUNCTION IF EXISTS public.create_list(text, text, uuid, timestamptz);

CREATE OR REPLACE FUNCTION public.create_list(
  p_name text,
  p_label text DEFAULT '',
  p_id uuid DEFAULT NULL,
  p_client_created_at timestamptz DEFAULT NULL,
  p_category_names text DEFAULT NULL,
  p_category_order text DEFAULT NULL,
  p_comment text DEFAULT NULL,
  p_member_filter text DEFAULT NULL,
  p_item_text_width text DEFAULT NULL,
  p_item_name_font_step smallint DEFAULT NULL,
  p_sum_scope text DEFAULT NULL,
  p_show_targets boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_final_name text;
  v_name_changed boolean;
  v_new_list public.lists%rowtype;
  v_client_created timestamptz := coalesce(p_client_created_at, now());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_trimmed_name = '' THEN
    RAISE EXCEPTION 'List name is required';
  END IF;

  v_final_name := public.resolve_unique_owner_list_name(v_user_id, v_trimmed_name, NULL);
  v_name_changed := lower(btrim(v_trimmed_name)) IS DISTINCT FROM lower(btrim(v_final_name));

  INSERT INTO public.lists (
    id,
    name,
    owner_id,
    client_created_at,
    category_names,
    category_order,
    comment
  )
  VALUES (
    coalesce(p_id, gen_random_uuid()),
    v_final_name,
    v_user_id,
    v_client_created,
    p_category_names,
    p_category_order,
    nullif(left(btrim(coalesce(p_comment, '')), 5000), '')
  )
  RETURNING * INTO v_new_list;

  UPDATE public.list_users
  SET sort_order = (
      SELECT coalesce(max(lu2.sort_order), -1) + 1
      FROM public.list_users lu2
      WHERE lu2.user_id = v_user_id
        AND lu2.list_id != v_new_list.id
    )
  WHERE user_id = v_user_id
    AND list_id != v_new_list.id;

  UPDATE public.list_users
  SET
    sort_order = 0,
    label = coalesce(nullif(btrim(p_label), ''), ''),
    member_filter = coalesce(nullif(btrim(p_member_filter), ''), member_filter, 'all'),
    item_text_width = coalesce(nullif(btrim(p_item_text_width), ''), item_text_width, 'auto'),
    item_name_font_step = coalesce(p_item_name_font_step, item_name_font_step, 3),
    sum_scope = coalesce(nullif(btrim(p_sum_scope), ''), sum_scope, 'none'),
    show_targets = coalesce(p_show_targets, show_targets, false)
  WHERE list_id = v_new_list.id
    AND user_id = v_user_id;

  RETURN jsonb_build_object(
    'list', to_jsonb(v_new_list),
    'display_name_changed', v_name_changed,
    'requested_name', v_trimmed_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_list(text, text, uuid, timestamptz, text, text, text, text, text, smallint, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.create_list(text, text, uuid, timestamptz, text, text, text, text, text, smallint, text, boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.bulk_add_states(uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.bulk_add_states(
  p_list_id uuid,
  p_members jsonb,
  p_states jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_ts timestamptz := now();
  m jsonb;
  s jsonb;
  v_mid uuid;
  v_iid uuid;
  v_req text;
  v_final text;
  v_members int := 0;
  v_states int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_list_id IS NULL THEN
    RAISE EXCEPTION 'p_list_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_users lu
    WHERE lu.list_id = p_list_id
      AND lu.user_id = v_user_id
      AND lu.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_members IS NOT NULL AND jsonb_typeof(p_members) = 'array' THEN
    FOR m IN SELECT * FROM jsonb_array_elements(p_members)
    LOOP
      v_mid := nullif(trim(m->>'id'), '')::uuid;
      IF v_mid IS NULL THEN
        CONTINUE;
      END IF;

      v_req := left(btrim(coalesce(m->>'name', '')), 2000);
      IF v_req = '' THEN
        RAISE EXCEPTION 'Member name cannot be empty';
      END IF;
      v_final := public.resolve_unique_member_name_for_list(p_list_id, v_req, v_mid);

      INSERT INTO public.members (
        id,
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
        v_mid,
        p_list_id,
        v_final,
        coalesce(nullif(trim(m->>'created_by'), '')::uuid, v_user_id),
        CASE
          WHEN m ? 'sort_order' AND jsonb_typeof(m->'sort_order') <> 'null' AND (m->>'sort_order') <> ''
            THEN (m->>'sort_order')::integer
          ELSE NULL
        END,
        coalesce((m->>'is_public')::boolean, false),
        coalesce((m->>'is_target')::boolean, false),
        coalesce((m->>'client_created_at')::timestamptz, v_ts),
        coalesce((m->>'server_created_at')::timestamptz, coalesce((m->>'client_created_at')::timestamptz, v_ts)),
        (m->>'deleted_at')::timestamptz,
        coalesce((m->>'version')::bigint, 1),
        (m->>'last_synced_at')::timestamptz,
        coalesce((m->>'updated_at')::timestamptz, v_ts)
      )
      ON CONFLICT (id) DO UPDATE SET
        list_id = excluded.list_id,
        name = excluded.name,
        created_by = excluded.created_by,
        sort_order = excluded.sort_order,
        is_public = excluded.is_public,
        is_target = excluded.is_target,
        client_created_at = excluded.client_created_at,
        server_created_at = excluded.server_created_at,
        deleted_at = excluded.deleted_at,
        version = excluded.version,
        last_synced_at = excluded.last_synced_at,
        updated_at = excluded.updated_at;

      v_members := v_members + 1;
    END LOOP;
  END IF;

  IF p_states IS NOT NULL AND jsonb_typeof(p_states) = 'array' THEN
    FOR s IN SELECT * FROM jsonb_array_elements(p_states)
    LOOP
      v_iid := nullif(trim(s->>'item_id'), '')::uuid;
      v_mid := nullif(trim(s->>'member_id'), '')::uuid;
      IF v_iid IS NULL OR v_mid IS NULL THEN
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.items i
        WHERE i.id = v_iid AND i.list_id = p_list_id AND i.deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'item_member_state references missing item %', v_iid;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.members m2
        WHERE m2.id = v_mid AND m2.list_id = p_list_id AND m2.deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'item_member_state references missing member %', v_mid;
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
      VALUES (
        v_iid,
        v_mid,
        greatest(coalesce((s->>'quantity')::integer, 1), 1),
        coalesce((s->>'done')::boolean, false),
        coalesce((s->>'assigned')::boolean, false),
        coalesce((s->>'updated_at')::timestamptz, v_ts),
        coalesce((s->>'client_created_at')::timestamptz, v_ts),
        coalesce((s->>'server_created_at')::timestamptz, coalesce((s->>'client_created_at')::timestamptz, v_ts)),
        (s->>'deleted_at')::timestamptz,
        coalesce((s->>'version')::bigint, 1),
        (s->>'last_synced_at')::timestamptz
      )
      ON CONFLICT (item_id, member_id) DO UPDATE SET
        quantity = excluded.quantity,
        done = excluded.done,
        assigned = excluded.assigned,
        updated_at = excluded.updated_at,
        client_created_at = excluded.client_created_at,
        server_created_at = excluded.server_created_at,
        deleted_at = excluded.deleted_at,
        version = excluded.version,
        last_synced_at = excluded.last_synced_at;

      v_states := v_states + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('members_upserted', v_members, 'states_upserted', v_states);
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_add_states(uuid, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.bulk_add_states(uuid, jsonb, jsonb) TO authenticated;
