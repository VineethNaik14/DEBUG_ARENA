-- =====================================================================
-- DEBUG ARENA — Combined repair script
--
-- This concatenates, in the correct order, the three migrations that fix:
--   1) the problems/submissions schema (renames, new columns)
--   2) profile field protection, submission-insert hardening, and the
--      scoring RPCs (award_points / increment_attempted / create_notification
--      / get_leaderboard / get_student_rank / start_competition / end_competition)
--   3) a drift-tolerant re-assertion of competitions/profiles RLS + grants
--      and the leaderboard/admin functions, safe to run even if this
--      database's versions of these objects had diverged (different
--      column sets, different function signatures, etc.)
--
-- It is safe to run this whole script in one paste in the Supabase SQL
-- Editor, in a single transaction. It is also safe to run more than once
-- (every statement is idempotent / drift-tolerant).
--
-- IMPORTANT: if your project uses `supabase db push` / migration tracking
-- and you run this combined script by hand, also mark the three source
-- migrations as already applied (or just keep using this file going
-- forward instead of `db push`) so the CLI doesn't try to re-run them and
-- report a mismatch.
-- =====================================================================

BEGIN;

/*
# Canonicalize the `problems` and `submissions` schema

The frontend (ProblemWorkspace, AdminProblems, ProblemList, etc.) was built
against a newer shape of the `problems` table than the one created by the
original migrations, and a database that had been manually edited out of
band had already drifted to (partially) match it. This migration makes the
actual Postgres schema agree with the frontend/canonical model described in
project documentation, regardless of which starting state a given database
is in. Every step is guarded with existence checks so this migration is safe
to run against:
  - a fresh database (only the original migrations have run), and
  - a database that was manually altered to already have some/all of the
    canonical columns.

1. `problems` changes
   - `points`              -> renamed to `max_points`
   - `time_limit`          -> renamed to `time_limit_ms`
   - `memory_limit`        -> renamed to `memory_limit_mb`
   - `supported_languages` (text[]) -> replaced by a single `language` text
     column (first supported language is kept)
   - `starter_code` (jsonb per-language map) -> split into two new text
     columns: `buggy_code` (the code the student must fix) and
     `starter_code` (kept identical to `buggy_code` for backwards
     compatibility with any code still reading it)
   - New descriptive text columns are added (default ''): `expected_behavior`,
     `input_format`, `output_format`, `constraints`, `sample_input`,
     `sample_output`
   - `public_test_cases` is unchanged (still jsonb)

2. `submissions` changes
   - No column renames needed; this migration only strengthens constraints
     (see the companion security migration) and adds a supporting index.

3. Data preservation
   - All renames are done with `ALTER TABLE ... RENAME COLUMN`, which
     preserves existing row data.
   - The old jsonb `starter_code` map is backfilled into the new
     `buggy_code`/`starter_code` text columns before being dropped.
*/

-- ---------------------------------------------------------------------
-- problems.points -> problems.max_points
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'points'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'max_points'
  ) THEN
    ALTER TABLE public.problems RENAME COLUMN points TO max_points;
  END IF;
END $$;

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS max_points integer NOT NULL DEFAULT 100;

-- ---------------------------------------------------------------------
-- problems.time_limit -> problems.time_limit_ms
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'time_limit'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'time_limit_ms'
  ) THEN
    ALTER TABLE public.problems RENAME COLUMN time_limit TO time_limit_ms;
  END IF;
END $$;

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS time_limit_ms integer NOT NULL DEFAULT 2000;

-- ---------------------------------------------------------------------
-- problems.memory_limit -> problems.memory_limit_mb
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'memory_limit'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'memory_limit_mb'
  ) THEN
    ALTER TABLE public.problems RENAME COLUMN memory_limit TO memory_limit_mb;
  END IF;
END $$;

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS memory_limit_mb integer NOT NULL DEFAULT 256;

-- ---------------------------------------------------------------------
-- problems.supported_languages (text[]) -> problems.language (text)
-- ---------------------------------------------------------------------
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS language text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'supported_languages'
  ) THEN
    UPDATE public.problems
    SET language = COALESCE(language, supported_languages[1], 'python')
    WHERE language IS NULL;

    ALTER TABLE public.problems DROP COLUMN supported_languages;
  END IF;
END $$;

UPDATE public.problems SET language = 'python' WHERE language IS NULL;
ALTER TABLE public.problems ALTER COLUMN language SET DEFAULT 'python';
ALTER TABLE public.problems ALTER COLUMN language SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'problems_language_check'
  ) THEN
    ALTER TABLE public.problems
      ADD CONSTRAINT problems_language_check CHECK (language IN ('python', 'cpp', 'java'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- problems.starter_code (jsonb per-language map) -> buggy_code + starter_code (text)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  legacy_is_jsonb boolean;
BEGIN
  SELECT (data_type = 'jsonb') INTO legacy_is_jsonb
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'starter_code';

  IF legacy_is_jsonb THEN
    ALTER TABLE public.problems RENAME COLUMN starter_code TO starter_code_legacy_jsonb;
  END IF;
END $$;

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS buggy_code text;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS starter_code text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'starter_code_legacy_jsonb'
  ) THEN
    UPDATE public.problems
    SET buggy_code = COALESCE(
          buggy_code,
          starter_code_legacy_jsonb ->> language,
          starter_code_legacy_jsonb ->> 'python',
          ''
        )
    WHERE buggy_code IS NULL;

    UPDATE public.problems
    SET starter_code = COALESCE(starter_code, buggy_code, '')
    WHERE starter_code IS NULL;

    ALTER TABLE public.problems DROP COLUMN starter_code_legacy_jsonb;
  END IF;
END $$;

UPDATE public.problems SET buggy_code = '' WHERE buggy_code IS NULL;
UPDATE public.problems SET starter_code = COALESCE(starter_code, buggy_code, '') WHERE starter_code IS NULL;
ALTER TABLE public.problems ALTER COLUMN buggy_code SET DEFAULT '';
ALTER TABLE public.problems ALTER COLUMN buggy_code SET NOT NULL;
ALTER TABLE public.problems ALTER COLUMN starter_code SET DEFAULT '';
ALTER TABLE public.problems ALTER COLUMN starter_code SET NOT NULL;

-- ---------------------------------------------------------------------
-- New descriptive columns
-- ---------------------------------------------------------------------
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS expected_behavior text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS input_format text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS output_format text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS constraints text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS sample_input text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS sample_output text NOT NULL DEFAULT '';

-- Drop the dangerous `hidden_test_cases` column if a prior manual edit ever
-- added it directly on `problems`. Hidden tests must ONLY ever live in the
-- separate `problem_hidden_test_cases` table, which has no student-facing
-- SELECT policy. A jsonb column on `problems` would be exposed to every
-- `select('*')` a student performs and would leak hidden answers.
ALTER TABLE public.problems DROP COLUMN IF EXISTS hidden_test_cases;

-- Drop other stale/unused columns that don't correspond to anything the
-- frontend reads or writes.
ALTER TABLE public.problems DROP COLUMN IF EXISTS per_problem_time_limit_sec;
ALTER TABLE public.problems DROP COLUMN IF EXISTS round;

-- round_number should already exist from an earlier migration, but ensure
-- it is present for databases that skipped it.
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS round_number integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'problems_round_number_check'
  ) THEN
    ALTER TABLE public.problems ADD CONSTRAINT problems_round_number_check CHECK (round_number IN (1, 2, 3));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- profiles: drop stale unused column, if present
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles DROP COLUMN IF EXISTS contest_time_seconds;

-- ---------------------------------------------------------------------
-- Drop the unused `competition_settings` table if a manual edit created it.
-- Competition state lives exclusively in `competitions`, managed by the
-- start_competition/end_competition SECURITY DEFINER functions.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.competition_settings;

-- ---------------------------------------------------------------------
-- submissions: supporting index for attempt-limit checks
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_submissions_user_problem_competition
  ON public.submissions(user_id, problem_id, competition_id);


-- =====================================================================
-- PART 2: profiles trigger, submissions insert hardening, scoring RPCs
-- =====================================================================

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


-- =====================================================================
-- PART 3: drift-tolerant reassertion of competitions/profiles/leaderboard
-- =====================================================================

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


COMMIT;
