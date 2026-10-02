/*
# Security fixes: profile field protection, submission inserts, scoring RPCs

1. `profiles` column protection
   The original migration used `REVOKE UPDATE ... GRANT UPDATE (full_name)`
   to stop students from changing `is_active`/`role`/points fields. Because
   Postgres column privileges apply to the *database role* (`authenticated`)
   rather than to the RLS-evaluated identity, this also silently blocked
   ADMIN users (who share the same `authenticated` Postgres role) from ever
   updating another student's `is_active`/`role` — the admin UI's
   "enable/disable student" and future role-management actions could never
   have worked. This migration replaces the column-privilege approach with
   a `BEFORE UPDATE` trigger that:
     - allows admins (per `is_admin()`) to update any column, and
     - allows students to update only their own safe, non-privileged
       columns (`full_name`), silently preserving all server-controlled
       fields (`role`, `is_active`, `total_points`, `problems_solved`,
       `problems_attempted`, `student_id`, `email`) if a non-admin request
       tries to change them.

2. `submissions` insert hardening
   The previous INSERT policy only checked `auth.uid() = user_id`, meaning
   a student could INSERT a submission row directly with an arbitrary
   `status`/`score`/`test_cases_passed` already set to ACCEPTED/max points,
   bypassing evaluation entirely. The policy now also requires that any
   client-side insert starts in the neutral `PENDING` state with zero
   score/results. The Edge Function (using the service role, which bypasses
   RLS) is the only path that can subsequently set the real, evaluated
   result.

3. Scoring RPC lockdown
   `award_points`, `increment_attempted`, and `create_notification` are
   SECURITY DEFINER functions that bypass RLS by design so they can update
   server-controlled fields. They were previously `GRANT EXECUTE`d to the
   `authenticated` role, meaning any signed-in student could call
   `award_points` directly with an arbitrary `p_user_id`/`p_score` and grant
   themselves (or anyone) unlimited points without ever passing evaluation.
   Execution is now revoked from `authenticated` — only the Edge Function's
   service-role client may call them. `get_student_rank` is also hardened
   so a student can only query their own rank (admins can query anyone's).
*/

-- ---------------------------------------------------------------------
-- Helper: drop ALL existing overloads of a function by name, regardless
-- of their argument/return signature. The live database in at least one
-- deployment had diverged versions of these functions (different
-- parameter lists and/or return shapes) from what any migration file
-- describes. `CREATE OR REPLACE FUNCTION` cannot change a function's
-- return type/OUT parameters — it requires the old one to be dropped
-- first — and since we cannot know in advance what a drifted signature
-- looks like, we look it up from the catalog and drop whatever is
-- actually there before creating the canonical version.
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

-- ---------------------------------------------------------------------
-- 1. profiles: trigger-based field protection (replaces column GRANT/REVOKE)
-- ---------------------------------------------------------------------

-- Undo the old blanket column restriction; the trigger below re-implements
-- the restriction correctly, per-identity rather than per-Postgres-role.
GRANT UPDATE ON public.profiles TO authenticated;

SELECT pg_temp.drop_all_overloads('protect_profile_fields');

CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Non-admins (students updating their own row) may only change full_name.
  -- Every other column is forced back to its previous value, regardless of
  -- what the client attempted to send.
  NEW.role := OLD.role;
  NEW.is_active := OLD.is_active;
  NEW.total_points := OLD.total_points;
  NEW.problems_solved := OLD.problems_solved;
  NEW.problems_attempted := OLD.problems_attempted;
  NEW.student_id := OLD.student_id;
  NEW.email := OLD.email;
  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_fields_trigger ON public.profiles;
CREATE TRIGGER protect_profile_fields_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- ---------------------------------------------------------------------
-- 2. submissions: lock down what a direct client-side INSERT may contain
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "insert_own_submissions" ON public.submissions;
CREATE POLICY "insert_own_submissions" ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'PENDING'
    AND score = 0
    AND test_cases_passed = 0
  );

-- No UPDATE policy is defined for `authenticated` on submissions: once a
-- submission row exists, only the Edge Function's service-role client
-- (which bypasses RLS) may update it with the real evaluated result. This
-- is intentional — do not add a broad student UPDATE policy here.

-- ---------------------------------------------------------------------
-- 3. Lock down scoring / notification RPCs to the service role only
--
-- These functions are (re)defined with CREATE OR REPLACE here, in full,
-- rather than assumed to already exist. This migration must work whether
-- or not the original `20260827041931_create_security_definer_functions`
-- migration ever actually ran against this database (on at least one
-- deployment it evidently had not — `award_points` did not exist, which
-- made a bare REVOKE on it fail with "function ... does not exist").
-- ---------------------------------------------------------------------

SELECT pg_temp.drop_all_overloads('award_points');

CREATE OR REPLACE FUNCTION public.award_points(p_user_id uuid, p_problem_id uuid, p_score integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted boolean;
BEGIN
  INSERT INTO public.solved_problems (user_id, problem_id, score)
  VALUES (p_user_id, p_problem_id, p_score)
  ON CONFLICT (user_id, problem_id) DO NOTHING
  RETURNING true INTO inserted;

  IF inserted THEN
    UPDATE public.profiles
    SET total_points = total_points + p_score,
        problems_solved = problems_solved + 1
    WHERE id = p_user_id;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

SELECT pg_temp.drop_all_overloads('create_notification');

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text DEFAULT 'INFO'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (p_user_id, p_title, p_message, p_type);
END;
$$;

-- Fix increment_attempted's logic: the original WHERE clause was a
-- self-referential subquery that did not correctly gate on "first attempt
-- at this problem" and could skip incrementing entirely for active
-- students. It is now a plain, unconditional increment — the Edge Function
-- only calls it once per submission that actually reaches evaluation
-- (never for requests rejected before evaluation, e.g. invalid problem,
-- inactive user, competition not live, or attempt limit already reached).
SELECT pg_temp.drop_all_overloads('increment_attempted');

CREATE OR REPLACE FUNCTION public.increment_attempted(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET problems_attempted = problems_attempted + 1
  WHERE id = p_user_id;
END;
$$;

-- Now that all three definitely exist, lock down who may call them.
REVOKE EXECUTE ON FUNCTION public.award_points(uuid, uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_attempted(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.award_points(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_attempted(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text) TO service_role;

-- get_leaderboard is required by get_student_rank below. Defined here too
-- in case the original security-definer-functions migration never ran.
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

GRANT EXECUTE ON FUNCTION public.get_leaderboard() TO authenticated;

-- get_student_rank: a student may look up only their own rank; only admins
-- may query an arbitrary student's rank. This function has no side effects
-- (SELECT-only) but there is no reason to let it enumerate other students.
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

-- start_competition / end_competition: also defined here in full for the
-- same self-containment reason as above.
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

GRANT EXECUTE ON FUNCTION public.start_competition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_competition(uuid) TO authenticated;
