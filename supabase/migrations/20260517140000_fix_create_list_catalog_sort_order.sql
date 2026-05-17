-- Fix create_list: new list at top (max sort_order + 1), not sort_order = 0 at bottom.
-- Regressed in 20260516120000_duplicate_list_local_first_rpcs.sql (legacy ascending convention).

DROP FUNCTION IF EXISTS public.create_list(text, text, uuid, timestamptz, text, text, text, text, text, smallint, text, boolean);

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
  SET
    sort_order = (
      SELECT coalesce(max(lu2.sort_order), -1) + 1
      FROM public.list_users lu2
      WHERE lu2.user_id = v_user_id
        AND lu2.list_id != v_new_list.id
    ),
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
