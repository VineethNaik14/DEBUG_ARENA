/*
# Re-assert competitions/profiles/leaderboard security objects

The original project brief noted that the production database had been
manually edited outside of migration tracking. Earlier migrations in this
project fix the *schema* and the *known* security bugs, but they generally
only `DROP POLICY IF EXISTS` + `CREATE POLICY` for objects that were being
changed. If the live database's actual policies/functions/grants for
`competitions`, `profiles`, or the leaderboard functions had drifted from
what any migration file describes (e.g. a manual restrictive GRANT/REVOKE
applied directly via the SQL editor and never captured in a migration),
no prior migration would have corrected it.

This migration is unconditional: every statement here is safe to re-run
against any starting state (fresh DB, DB that already ran all prior
migrations, or a DB with unknown manual drift), and forces these objects
back to the intended, documented behavior.

This addresses three reported symptoms:
  1. Admins could not create/update the competition — table-level grants
     and/or RLS policies on `competitions` may have drifted; they are now
     unconditionally re-created and re-granted.
  2. Disabling a student appeared to work in the UI but reverted after a
     refresh — the profiles UPDATE grant/trigger from the prior security
     migration is re-asserted here defensively.
  3. A student's own leaderboard view showed only themselves — this is the
     signature of `get_leaderboard()` either not being SECURITY DEFINER (so
     it ran under the caller's own RLS, which only permits reading your own
     profile row) or missing its EXECUTE grant. It is recreated here
     exactly as SECURITY DEFINER with `search_path` pinned, and re-granted.
*/

-- ---------------------------------------------------------------------
-- competitions: re-assert table grants + RLS policies
-- ---------------------------------------------------------------------

-- Baseline table grants. RLS (recreated below) is what actually restricts
-- who can do what — these grants only ensure Postgres doesn't reject the
-- request before RLS is even evaluated (which is what a manual REVOKE
-- would cause, indistinguishable from "insert/update silently do nothing"
-- in the Supabase JS client if not checked for `error`, or a hard
-- permission-denied error otherwise).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitions TO authenticated;

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_competitions" ON public.competitions;
CREATE POLICY "select_competitions" ON public.competitions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin_insert_competitions" ON public.competitions;
CREATE POLICY "admin_insert_competitions" ON public.competitions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_competitions" ON public.competitions;
CREATE POLICY "admin_update_competitions" ON public.competitions
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_competitions" ON public.competitions;
CREATE POLICY "admin_delete_competitions" ON public.competitions
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ---------------------------------------------------------------------
-- profiles: re-assert table grants (RLS policies + protective trigger
-- were already recreated in the prior security migration; grants are
-- re-asserted here in case of drift independent of that migration)
-- ---------------------------------------------------------------------

GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------
-- is_admin / get_leaderboard / get_student_rank / start_competition /
-- end_competition: recreate exactly as SECURITY DEFINER with a pinned
-- search_path, and re-grant EXECUTE. If any of these had drifted to a
-- plain (SECURITY INVOKER) function on the live database, it would run
-- under the calling student's own privileges — meaning `get_leaderboard`
-- would only ever be able to see rows the caller's own RLS allows (their
-- own profile row), producing exactly the "I can only see myself on the
-- leaderboard" symptom.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Helper: drop ALL existing overloads of a function by name, regardless
-- of signature. See the equivalent helper in
-- 20260926150100_security_fixes_profiles_submissions_rpcs.sql for the
-- full explanation — the short version is that `CREATE OR REPLACE
-- FUNCTION` cannot change a return type, and the live database has been
-- found to have diverged signatures for some of these functions, so we
-- look up whatever actually exists and drop it before recreating.
-- Defined again here (rather than relying on the other migration's
-- pg_temp function) so this migration is safe to run independently, in
-- any order, in its own session.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.drop_all_overloads(fn_name text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = fn_name
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END;
$fn$;

-- NOTE: is_admin() is deliberately NOT dropped-and-recreated via the
-- drop_all_overloads helper above. It is referenced inside 17+ RLS policy
-- expressions across `problems`, `problem_hidden_test_cases`, and
-- `competitions` (Postgres records a hard dependency between a policy and
-- any function its USING/WITH CHECK clause calls). A `DROP FUNCTION ...
-- CASCADE` on it would silently delete every one of those policies — most
-- of which this migration does not recreate — leaving those tables with
-- zero policies and therefore zero access under RLS. A plain
-- `CREATE OR REPLACE` is sufficient here since its signature
-- (zero args, returns boolean) is standard and has shown no evidence of
-- having drifted.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  );
$$;

SELECT pg_temp.drop_all_overloads('get_leaderboard');

CREATE OR REPLACE FUNCTION public.get_leaderboard()
RETURNS TABLE (
  rank bigint,
  user_id uuid,
  full_name text,
  student_id text,
  total_points integer,
  problems_solved integer,
  first_solve_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      p.id AS user_id,
      p.full_name,
      p.student_id,
      p.total_points,
      p.problems_solved,
      MIN(sp.solved_at) AS first_solve_time
    FROM public.profiles p
    LEFT JOIN public.solved_problems sp ON sp.user_id = p.id
    WHERE p.role = 'STUDENT' AND p.is_active = true
    GROUP BY p.id, p.full_name, p.student_id, p.total_points, p.problems_solved
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY total_points DESC, problems_solved DESC, first_solve_time ASC NULLS LAST) AS rank,
    ranked.user_id,
    ranked.full_name,
    ranked.student_id,
    ranked.total_points,
    ranked.problems_solved,
    ranked.first_solve_time
  FROM ranked
  ORDER BY total_points DESC, problems_solved DESC, first_solve_time ASC NULLS LAST;
END;
$$;

SELECT pg_temp.drop_all_overloads('start_competition');

CREATE OR REPLACE FUNCTION public.start_competition(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;
  UPDATE public.competitions
  SET status = 'LIVE',
      start_time = COALESCE(start_time, now()),
      end_time = COALESCE(end_time, now() + (COALESCE(duration, 120) || ' minutes')::interval)
  WHERE id = p_competition_id;
END;
$$;

SELECT pg_temp.drop_all_overloads('end_competition');

CREATE OR REPLACE FUNCTION public.end_competition(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;
  UPDATE public.competitions
  SET status = 'ENDED',
      end_time = now()
  WHERE id = p_competition_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_competition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_competition(uuid) TO authenticated;

-- get_student_rank was already hardened (own rank only, unless admin) in
-- the prior security migration; recreate it identically here in case that
-- migration's version was itself superseded by drift, then re-grant.
SELECT pg_temp.drop_all_overloads('get_student_rank');

CREATE OR REPLACE FUNCTION public.get_student_rank(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_rank integer;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT rank INTO student_rank
  FROM public.get_leaderboard()
  WHERE user_id = p_user_id;

  RETURN COALESCE(student_rank, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_rank(uuid) TO authenticated;
