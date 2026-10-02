-- =====================================================================
-- DEBUG ARENA — Diagnostic script
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor) while
-- logged in as the project owner. It runs as `postgres`, which bypasses
-- RLS, so it can see the true state regardless of what any given user's
-- session would see.
--
-- Paste the FULL output back and we can pinpoint the exact cause.
-- =====================================================================

-- 1) Have the new migrations actually been applied?
--    Expect: max_points/time_limit_ms/buggy_code columns present on
--    problems, and NOT points/time_limit/supported_languages.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'problems'
order by column_name;

-- Expect a row for 'protect_profile_fields_trigger'.
select tgname
from pg_trigger
where tgrelid = 'public.profiles'::regclass and not tgisinternal;

-- Expect prosecdef = true (SECURITY DEFINER) for every one of these.
select proname, prosecdef
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('is_admin', 'get_leaderboard', 'get_student_rank',
                   'start_competition', 'end_competition', 'award_points',
                   'increment_attempted', 'create_notification');

-- 2) Is your admin account actually recognized as admin at the DB level?
--    Replace the email below with your actual admin login email.
select
  p.id            as profile_id,
  u.id            as auth_user_id,
  p.id = u.id     as ids_match,
  p.role,
  p.role = 'ADMIN' as role_is_exactly_admin,
  p.is_active
from public.profiles p
join auth.users u on u.email = p.email
where p.email = 'YOUR_ADMIN_EMAIL_HERE';

-- 3) What do the live RLS policies on the affected tables actually say?
select tablename, policyname, cmd, qual, with_check
from pg_policies
where tablename in ('competitions', 'profiles')
order by tablename, cmd;

-- 4) What are the *effective* table-level grants (not just what a
--    migration file says was granted — what's actually live)?
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('competitions', 'profiles')
  and grantee in ('authenticated', 'anon', 'public')
order by table_name, grantee, privilege_type;

-- 5) Column-level grants on profiles (looking for a lingering
--    column-specific restriction left over from before).
select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
order by grantee, column_name;
