-- handle_new_user → include text_direction on new profile rows
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    nickname,
    label_filter,
    theme,
    text_direction,
    client_created_at,
    server_created_at,
    deleted_at,
    version,
    last_synced_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'nickname',
    '',
    'light',
    'ltr',
    now(),
    now(),
    NULL,
    1,
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    email = excluded.email,
    nickname = coalesce(excluded.nickname, public.profiles.nickname);

  RETURN NEW;
END;
$$;
