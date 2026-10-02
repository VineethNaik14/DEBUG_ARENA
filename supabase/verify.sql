-- DEBUG ARENA — post-migration verification. Run in the Supabase SQL editor.
-- Every query should return the "expected" result noted above it.

-- 1. expected: 0 rows  (no function in public is executable by anon/PUBLIC except student_id_available)
SELECT p.oid::regprocedure AS function_name
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  AND p.proname <> 'student_id_available'
  AND (has_function_privilege('anon', p.oid, 'EXECUTE'));

-- 2. expected: only reserve/finalize/void_submission are NOT executable by authenticated
SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' ORDER BY 1;

-- 3. expected: authenticated may UPDATE only profiles.full_name and notifications.is_read
SELECT table_name, column_name FROM information_schema.column_privileges
WHERE grantee = 'authenticated' AND table_schema = 'public' AND privilege_type = 'UPDATE'
  AND table_name IN ('profiles','notifications','submissions','solved_problems') ORDER BY 1,2;

-- 4. expected: every app table has RLS on
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname IN
 ('profiles','problems','competitions','submissions','solved_problems','notifications');

-- 5. the policy set (nothing grants students INSERT/UPDATE/DELETE on submissions/solved_problems)
SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' ORDER BY 1,2;

-- 6. expected: 0  (counters match the authoritative tables)
SELECT count(*) AS drifted_profiles FROM public.profiles p
WHERE p.total_points IS DISTINCT FROM COALESCE((SELECT SUM(score) FROM public.solved_problems s WHERE s.user_id = p.id),0)
   OR p.problems_solved IS DISTINCT FROM (SELECT COUNT(*) FROM public.solved_problems s WHERE s.user_id = p.id);

-- 7. expected: your admin account(s)
SELECT email, role, is_active FROM public.profiles WHERE role = 'ADMIN';

-- 8. expected: no error. (Returns rows only for a signed-in user; in the SQL editor auth.uid() is null so it is empty.)
SELECT * FROM public.get_leaderboard() LIMIT 5;
