-- Post-migration verification script for client-generated ID RPC updates.
-- Run this in Supabase SQL Editor after applying:
--   client_generated_ids_rpc_migration_corrected.sql

-- ---------------------------------------------------------------------------
-- 1) Show all relevant public functions and signatures
-- ---------------------------------------------------------------------------
select
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_list',
    'bulk_add_list_items',
    'import_list',
    'duplicate_list'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- ---------------------------------------------------------------------------
-- 2) Assert expected signatures exist (returns one row per check)
-- ---------------------------------------------------------------------------
with expected as (
  select * from (
    values
      (
        'create_list'::text,
        'p_name text, p_label text, p_id uuid'::text
      ),
      (
        'bulk_add_list_items'::text,
        'p_list_id uuid, p_category smallint, p_lines text[], p_item_ids uuid[]'::text
      ),
      (
        'import_list'::text,
        'p_name text, p_label text, p_category_names text, p_rows jsonb, p_has_targets boolean, p_id uuid, p_item_ids uuid[]'::text
      ),
      (
        'duplicate_list'::text,
        'p_source_list_id uuid, p_new_name text, p_label text, p_id uuid, p_item_ids uuid[], p_target_member_id uuid'::text
      )
  ) as t(function_name, args)
),
actual as (
  select
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_list', 'bulk_add_list_items', 'import_list', 'duplicate_list')
)
select
  e.function_name,
  e.args as expected_args,
  exists (
    select 1
    from actual a
    where a.function_name = e.function_name
      and a.args = e.args
  ) as signature_present
from expected e
order by e.function_name;

-- ---------------------------------------------------------------------------
-- 3) Ensure old overloads are gone
-- ---------------------------------------------------------------------------
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    (p.proname = 'create_list' and pg_get_function_identity_arguments(p.oid) = 'p_name text, p_label text')
    or (p.proname = 'bulk_add_list_items' and pg_get_function_identity_arguments(p.oid) = 'p_list_id uuid, p_category smallint, p_lines text[]')
    or (p.proname = 'import_list' and pg_get_function_identity_arguments(p.oid) = 'p_name text, p_label text, p_category_names text, p_rows jsonb, p_has_targets boolean')
    or (p.proname = 'duplicate_list' and pg_get_function_identity_arguments(p.oid) = 'p_source_list_id uuid, p_new_name text')
    or (p.proname = 'duplicate_list' and pg_get_function_identity_arguments(p.oid) = 'p_source_list_id uuid, p_new_name text, p_label text')
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Expected: zero rows above.

-- ---------------------------------------------------------------------------
-- 4) Check grants for authenticated role
-- ---------------------------------------------------------------------------
select
  routine_name as function_name,
  specific_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('create_list', 'bulk_add_list_items', 'import_list', 'duplicate_list')
  and grantee = 'authenticated'
order by routine_name, specific_name, privilege_type;

-- ---------------------------------------------------------------------------
-- 5) Optional (manual) smoke notes
-- ---------------------------------------------------------------------------
-- - Call create_list with and without p_id and verify created list id behavior.
-- - Call bulk_add_list_items with p_item_ids and verify inserted item ids match.
-- - Call import_list with p_item_ids and verify imported item ids match.
-- - Call duplicate_list with p_id/p_item_ids/p_target_member_id and verify ids match.
