/*
# DEBUG ARENA — canonical schema + security hardening

This migration is the single point where the database is forced into the
shape the application expects. It is written to be safe against:
  * a fresh database (all earlier migrations just ran), and
  * a database that drifted from the migrations through manual edits
    (every policy on the app tables is dropped and re-created; privileges
    are reset explicitly rather than assumed).

## Schema changes (data-preserving)

problems
  - `test_cases` (jsonb array of {input, expected_output, is_hidden}) becomes
    the ONE authoritative test-case store. Existing `public_test_cases` and
    every row of `problem_hidden_test_cases` are merged into it
    (is_hidden=false / true) before those objects are dropped.
  - `starter_code` is dropped (its content was already copied to
    `buggy_code` by an earlier migration; copied again here if empty).
  - Students can no longer read the table at all. They read the
    `student_problems` view, which never contains hidden tests or expected
    hidden outputs.

submissions
  - renamed: test_cases_passed -> passed_tests, total_test_cases ->
    total_tests, submitted_at -> created_at, execution_time ->
    execution_time_ms (integer), memory_used -> memory_used_mb.
  - students can only SELECT; rows are written exclusively by the
    evaluate-code Edge Function through reserve/finalize functions.

profiles
  - column-level UPDATE privilege: authenticated may update `full_name`
    only. Admin changes (is_active) go through admin_set_user_active().
    The old trigger-based protection is removed: it reverted points for
    the service-role scoring path as well (is_admin() is false when there
    is no end-user JWT), so points could never be stored.

## Security
  - Every SECURITY DEFINER function pins search_path and has EXECUTE
    revoked from PUBLIC, anon and authenticated, then re-granted explicitly.
    (Revoking only from `authenticated`, as an earlier migration did, is
    ineffective because the implicit PUBLIC grant still applies.)
  - award_points / increment_attempted are replaced by
    reserve_submission / finalize_submission / void_submission, callable by
    service_role only. The score is read from problems.max_points inside the
    database; the caller cannot supply one.
  - get_leaderboard() is rewritten (the previous version failed with
    "column reference is ambiguous") and computes standings from
    solved_problems.
*/
-- Ensure the updated_at trigger helper exists.
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
-- ---------------------------------------------------------------------
-- 0. Helpers (session-local)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.rename_column(p_table text, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_old boolean;
  v_new boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_old
  ) INTO v_old;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_new
  ) INTO v_new;

  IF v_old AND NOT v_new THEN
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', p_table, p_old, p_new);
  ELSIF v_old AND v_new THEN
    EXECUTE format('UPDATE public.%I SET %I = COALESCE(%I, %I)', p_table, p_new, p_new, p_old);
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN %I', p_table, p_old);
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------
-- 1. Drop EVERY existing policy on the application tables.
--    They are all re-created below. This removes drifted / restrictive
--    policies that silently blocked admin writes.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles', 'problems', 'competitions', 'submissions',
        'solved_problems', 'notifications', 'problem_hidden_test_cases'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. profiles
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS protect_profile_fields_trigger ON public.profiles;

UPDATE public.profiles SET is_active = true WHERE is_active IS NULL;
UPDATE public.profiles SET total_points = 0 WHERE total_points IS NULL;
UPDATE public.profiles SET problems_solved = 0 WHERE problems_solved IS NULL;
UPDATE public.profiles SET problems_attempted = 0 WHERE problems_attempted IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN total_points SET DEFAULT 0,
  ALTER COLUMN total_points SET NOT NULL,
  ALTER COLUMN problems_solved SET DEFAULT 0,
  ALTER COLUMN problems_solved SET NOT NULL,
  ALTER COLUMN problems_attempted SET DEFAULT 0,
  ALTER COLUMN problems_attempted SET NOT NULL;

-- ---------------------------------------------------------------------
-- 3. problems -> canonical shape
-- ---------------------------------------------------------------------
SELECT pg_temp.rename_column('problems', 'points', 'max_points');
SELECT pg_temp.rename_column('problems', 'time_limit', 'time_limit_ms');
SELECT pg_temp.rename_column('problems', 'memory_limit', 'memory_limit_mb');

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS max_points integer NOT NULL DEFAULT 100;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS time_limit_ms integer NOT NULL DEFAULT 2000;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS memory_limit_mb integer NOT NULL DEFAULT 256;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'python';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS buggy_code text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS expected_behavior text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS input_format text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS output_format text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS constraints text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS sample_input text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS sample_output text NOT NULL DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS round_number integer NOT NULL DEFAULT 1;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS test_cases jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.problems SET difficulty = 'EASY' WHERE difficulty IS NULL;
UPDATE public.problems SET is_active = true WHERE is_active IS NULL;
UPDATE public.problems SET problem_order = 0 WHERE problem_order IS NULL;
ALTER TABLE public.problems
  ALTER COLUMN difficulty SET DEFAULT 'EASY',
  ALTER COLUMN difficulty SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN problem_order SET DEFAULT 0,
  ALTER COLUMN problem_order SET NOT NULL;

-- 3a. Merge public test cases into test_cases (is_hidden = false)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems' AND column_name = 'public_test_cases'
  ) THEN
    EXECUTE $q$
      UPDATE public.problems p
      SET test_cases = COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'input', COALESCE(e.t ->> 'input', ''),
                   'expected_output', COALESCE(e.t ->> 'expected_output', ''),
                   'is_hidden', false
                 ) ORDER BY e.ord)
        FROM jsonb_array_elements(p.public_test_cases) WITH ORDINALITY AS e(t, ord)
        WHERE jsonb_typeof(e.t) = 'object'
      ), '[]'::jsonb)
      WHERE jsonb_typeof(p.public_test_cases) = 'array'
        AND p.test_cases = '[]'::jsonb
    $q$;
  END IF;
END $$;

-- 3b. Merge hidden test cases (is_hidden = true), then drop the old table
DO $$
BEGIN
  IF to_regclass('public.problem_hidden_test_cases') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE public.problems p
      SET test_cases = p.test_cases || h.cases
      FROM (
        SELECT t.problem_id,
               jsonb_agg(
                 jsonb_build_object(
                   'input', COALESCE(t.test_case ->> 'input', ''),
                   'expected_output', COALESCE(t.test_case ->> 'expected_output', ''),
                   'is_hidden', true
                 ) ORDER BY t.created_at, t.id) AS cases
        FROM public.problem_hidden_test_cases t
        WHERE jsonb_typeof(t.test_case) = 'object'
        GROUP BY t.problem_id
      ) h
      WHERE h.problem_id = p.id
    $q$;
  END IF;
END $$;

-- 3c. Keep the student's starting code if only the legacy column had it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'problems'
      AND column_name = 'starter_code' AND data_type = 'text'
  ) THEN
    EXECUTE $q$
      UPDATE public.problems
      SET buggy_code = starter_code
      WHERE COALESCE(buggy_code, '') = '' AND COALESCE(starter_code, '') <> ''
    $q$;
  END IF;
END $$;

ALTER TABLE public.problems DROP COLUMN IF EXISTS starter_code;
ALTER TABLE public.problems DROP COLUMN IF EXISTS public_test_cases;
ALTER TABLE public.problems DROP COLUMN IF EXISTS hidden_test_cases;
DROP TABLE IF EXISTS public.problem_hidden_test_cases CASCADE;

-- 3d. Validation of the test_cases document (also enforced for admin edits)
CREATE OR REPLACE FUNCTION public.is_valid_test_cases(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) IS DISTINCT FROM 'array' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p) AS e(t)
      WHERE jsonb_typeof(e.t) IS DISTINCT FROM 'object'
         OR jsonb_typeof(e.t -> 'input') IS DISTINCT FROM 'string'
         OR jsonb_typeof(e.t -> 'expected_output') IS DISTINCT FROM 'string'
         OR ((e.t -> 'is_hidden') IS NOT NULL
             AND jsonb_typeof(e.t -> 'is_hidden') IS DISTINCT FROM 'boolean')
    )
  END
$$;

ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_test_cases_valid;
ALTER TABLE public.problems
  ADD CONSTRAINT problems_test_cases_valid CHECK (public.is_valid_test_cases(test_cases));

ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_language_check;
ALTER TABLE public.problems
  ADD CONSTRAINT problems_language_check CHECK (language IN ('python', 'cpp', 'java')) NOT VALID;

ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_limits_check;
ALTER TABLE public.problems
  ADD CONSTRAINT problems_limits_check CHECK (
    max_points >= 0
    AND time_limit_ms BETWEEN 100 AND 60000
    AND memory_limit_mb BETWEEN 16 AND 4096
  ) NOT VALID;

ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_round_number_check;
ALTER TABLE public.problems
  ADD CONSTRAINT problems_round_number_check CHECK (round_number IN (1, 2, 3)) NOT VALID;

DROP TRIGGER IF EXISTS problems_updated_at ON public.problems;
CREATE TRIGGER problems_updated_at
  BEFORE UPDATE ON public.problems
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------
-- 4. competitions
-- ---------------------------------------------------------------------
UPDATE public.competitions SET status = 'UPCOMING' WHERE status IS NULL;
UPDATE public.competitions SET maximum_attempts = 3 WHERE maximum_attempts IS NULL;
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS penalty_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.competitions
  ALTER COLUMN status SET DEFAULT 'UPCOMING',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN maximum_attempts SET DEFAULT 3,
  ALTER COLUMN maximum_attempts SET NOT NULL;

ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_status_check;
ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_status_check CHECK (status IN ('UPCOMING', 'LIVE', 'ENDED')) NOT VALID;
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_time_order_check;
ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_time_order_check CHECK (
    start_time IS NULL OR end_time IS NULL OR end_time >= start_time
  ) NOT VALID;
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_attempts_check;
ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_attempts_check CHECK (maximum_attempts >= 1) NOT VALID;

DROP TRIGGER IF EXISTS competitions_updated_at ON public.competitions;
CREATE TRIGGER competitions_updated_at
  BEFORE UPDATE ON public.competitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX IF NOT EXISTS idx_competitions_created_at ON public.competitions (created_at DESC);

-- ---------------------------------------------------------------------
-- 5. submissions -> canonical column names
-- ---------------------------------------------------------------------
SELECT pg_temp.rename_column('submissions', 'test_cases_passed', 'passed_tests');
SELECT pg_temp.rename_column('submissions', 'total_test_cases', 'total_tests');
SELECT pg_temp.rename_column('submissions', 'submitted_at', 'created_at');
SELECT pg_temp.rename_column('submissions', 'execution_time', 'execution_time_ms');
SELECT pg_temp.rename_column('submissions', 'memory_used', 'memory_used_mb');

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS competition_id uuid REFERENCES public.competitions(id) ON DELETE SET NULL;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS passed_tests integer NOT NULL DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS total_tests integer NOT NULL DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS execution_time_ms integer;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS memory_used_mb numeric;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submissions'
      AND column_name = 'execution_time_ms' AND data_type <> 'integer'
  ) THEN
    ALTER TABLE public.submissions
      ALTER COLUMN execution_time_ms TYPE integer USING round(execution_time_ms)::integer;
  END IF;
END $$;

UPDATE public.submissions SET status = 'PENDING' WHERE status IS NULL;
UPDATE public.submissions SET score = 0 WHERE score IS NULL;
UPDATE public.submissions SET passed_tests = 0 WHERE passed_tests IS NULL;
UPDATE public.submissions SET total_tests = 0 WHERE total_tests IS NULL;
ALTER TABLE public.submissions
  ALTER COLUMN status SET DEFAULT 'PENDING',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN score SET DEFAULT 0,
  ALTER COLUMN score SET NOT NULL;

ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_language_check;
ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_language_check CHECK (language IN ('python', 'cpp', 'java')) NOT VALID;
ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_counts_check;
ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_counts_check CHECK (
    passed_tests >= 0 AND total_tests >= 0 AND passed_tests <= total_tests
  ) NOT VALID;

DROP INDEX IF EXISTS public.idx_submissions_user_problem_competition;
CREATE INDEX IF NOT EXISTS idx_submissions_user_problem_competition
  ON public.submissions (user_id, problem_id, competition_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON public.submissions (created_at DESC);

-- ---------------------------------------------------------------------
-- 6. solved_problems: exactly one record per (user, problem)
-- ---------------------------------------------------------------------

-- Add the authoritative score column used by the leaderboard.
ALTER TABLE public.solved_problems
  ADD COLUMN IF NOT EXISTS score integer;

-- Preserve existing solved points by deriving them from the problem's
-- max_points.
UPDATE public.solved_problems sp
SET score = COALESCE(p.max_points, 0)
FROM public.problems p
WHERE p.id = sp.problem_id
  AND sp.score IS NULL;

ALTER TABLE public.solved_problems
  ALTER COLUMN score SET DEFAULT 0,
  ALTER COLUMN score SET NOT NULL;

-- Remove duplicate user/problem records, keeping the earliest solved row.
DELETE FROM public.solved_problems a
USING public.solved_problems b
WHERE a.user_id = b.user_id
  AND a.problem_id = b.problem_id
  AND (a.solved_at, a.id) > (b.solved_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS solved_problems_user_problem_uniq
  ON public.solved_problems (user_id, problem_id);

-- Reconcile the denormalised profile counters with the authoritative tables.
UPDATE public.profiles p
SET total_points = s.pts,
    problems_solved = s.cnt,
    problems_attempted = s.att
FROM (
  SELECT pr.id,
         COALESCE(
           (SELECT SUM(sp.score)
            FROM public.solved_problems sp
            WHERE sp.user_id = pr.id),
           0
         )::integer AS pts,
         (SELECT COUNT(*)
          FROM public.solved_problems sp
          WHERE sp.user_id = pr.id)::integer AS cnt,
         (SELECT COUNT(*)
          FROM public.submissions su
          WHERE su.user_id = pr.id)::integer AS att
  FROM public.profiles pr
) s
WHERE s.id = p.id
  AND (
    p.total_points IS DISTINCT FROM s.pts
    OR p.problems_solved IS DISTINCT FROM s.cnt
    OR p.problems_attempted IS DISTINCT FROM s.att
  );

-- ---------------------------------------------------------------------
-- 7. Functions
-- ---------------------------------------------------------------------

-- Remove old versions whose signature / return type changes, or that are
-- replaced by the reserve/finalize flow. CASCADE is safe: every policy on
-- the application tables was dropped above.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'protect_profile_fields', 'award_points', 'increment_attempted',
        'create_notification', 'get_leaderboard', 'get_student_rank',
        'start_competition', 'end_competition'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;

-- 7.1 identity helpers ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'ADMIN' AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND is_active
  );
$$;

-- 7.2 sign-up ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, student_id, email, role)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''), 'New User'),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'student_id'), ''),
    NEW.email,
    'STUDENT'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_id_available(p_student_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(student_id) = lower(btrim(p_student_id))
  );
$$;

-- 7.3 leaderboard --------------------------------------------------------
-- Standings come from solved_problems (authoritative). Ties share a rank
-- (RANK): equal points, then equal solved count, then equal time of the
-- last accepted solve. Earlier last-solve wins a tie-break.
CREATE OR REPLACE FUNCTION public.get_leaderboard()
RETURNS TABLE (
  rank bigint,
  user_id uuid,
  full_name text,
  student_id text,
  total_points integer,
  problems_solved integer,
  last_solve_time timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH agg AS (
    SELECT pr.id AS uid,
           pr.full_name AS fname,
           pr.student_id AS sid,
           COALESCE(SUM(sp.score), 0)::integer AS pts,
           COUNT(sp.id)::integer AS solved,
           MAX(sp.solved_at) AS last_solve
    FROM public.profiles pr
    LEFT JOIN public.solved_problems sp ON sp.user_id = pr.id
    WHERE pr.role = 'STUDENT'
      AND pr.is_active
      AND public.is_active_user()
    GROUP BY pr.id, pr.full_name, pr.student_id
  )
  SELECT RANK() OVER (ORDER BY agg.pts DESC, agg.solved DESC, agg.last_solve ASC NULLS LAST)::bigint,
         agg.uid,
         agg.fname,
         agg.sid,
         agg.pts,
         agg.solved,
         agg.last_solve
  FROM agg
  ORDER BY 1, agg.fname, agg.uid;
$$;

CREATE OR REPLACE FUNCTION public.get_student_rank(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rank bigint;
BEGIN
  IF p_user_id IS DISTINCT FROM (SELECT auth.uid()) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT l.rank INTO v_rank
  FROM public.get_leaderboard() l
  WHERE l.user_id = p_user_id;

  RETURN COALESCE(v_rank, 0)::integer;
END;
$$;

-- 7.4 admin: users ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_active(p_user_id uuid, p_active boolean)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.profiles;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_active IS NULL THEN
    RAISE EXCEPTION 'p_active is required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = (SELECT auth.uid()) AND NOT p_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own account' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET is_active = p_active
  WHERE id = p_user_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

-- 7.5 admin: competitions --------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_competition(
  p_name text,
  p_description text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_duration integer,
  p_maximum_attempts integer,
  p_id uuid DEFAULT NULL
)
RETURNS public.competitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.competitions;
  v_name text := btrim(COALESCE(p_name, ''));
  v_duration integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Competition name is required' USING ERRCODE = '22023';
  END IF;
  IF p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION 'Start and end time are required' USING ERRCODE = '22023';
  END IF;
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after the start time' USING ERRCODE = '22023';
  END IF;
  IF p_maximum_attempts IS NULL OR p_maximum_attempts < 1 THEN
    RAISE EXCEPTION 'Maximum attempts must be at least 1' USING ERRCODE = '22023';
  END IF;

  v_duration := COALESCE(
    NULLIF(p_duration, 0),
    GREATEST(1, ceil(extract(epoch FROM (p_end_time - p_start_time)) / 60.0)::integer)
  );

  IF p_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.competitions c
      WHERE c.status = 'LIVE' AND (c.end_time IS NULL OR c.end_time > now())
    ) THEN
      RAISE EXCEPTION 'A competition is currently live. End it before creating a new one.'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.competitions (
      name, description, start_time, end_time, duration, maximum_attempts, status
    ) VALUES (
      v_name, NULLIF(btrim(COALESCE(p_description, '')), ''),
      p_start_time, p_end_time, v_duration, p_maximum_attempts, 'UPCOMING'
    )
    RETURNING * INTO v_row;
  ELSE
    IF EXISTS (SELECT 1 FROM public.competitions c WHERE c.id = p_id AND c.status = 'ENDED') THEN
      RAISE EXCEPTION 'This competition has ended and cannot be edited. Create a new competition instead.'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.competitions
    SET name = v_name,
        description = NULLIF(btrim(COALESCE(p_description, '')), ''),
        start_time = p_start_time,
        end_time = p_end_time,
        duration = v_duration,
        maximum_attempts = p_maximum_attempts
    WHERE id = p_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Competition not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_competition(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c public.competitions;
  v_len interval;
  v_starts_now boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_c FROM public.competitions WHERE id = p_competition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_c.status = 'ENDED' THEN
    RAISE EXCEPTION 'This competition has already ended. Create a new competition instead.'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.competitions o
    WHERE o.id <> v_c.id AND o.status = 'LIVE' AND (o.end_time IS NULL OR o.end_time > now())
  ) THEN
    RAISE EXCEPTION 'Another competition is already live.' USING ERRCODE = '22023';
  END IF;

  v_len := COALESCE(v_c.end_time - v_c.start_time, make_interval(mins => COALESCE(v_c.duration, 120)));
  IF v_len <= interval '0' THEN
    v_len := make_interval(mins => COALESCE(v_c.duration, 120));
  END IF;

  -- Starting before the scheduled time (or without one) opens the window
  -- NOW and keeps the configured length. Otherwise keep the scheduled
  -- window unless it has already run out.
  v_starts_now := v_c.start_time IS NULL OR v_c.start_time > now();

  UPDATE public.competitions
  SET status = 'LIVE',
      start_time = CASE WHEN v_starts_now THEN now() ELSE v_c.start_time END,
      end_time = CASE
                   WHEN v_starts_now OR v_c.end_time IS NULL OR v_c.end_time <= now()
                   THEN now() + v_len
                   ELSE v_c.end_time
                 END
  WHERE id = v_c.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_competition(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.competitions
  SET status = 'ENDED',
      start_time = LEAST(COALESCE(start_time, now()), now()),
      end_time = now()
  WHERE id = p_competition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- 7.6 notifications (admin-only for end users; server writes use finalize) --
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text DEFAULT 'INFO'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_type NOT IN ('INFO', 'SUCCESS', 'WARNING', 'ERROR') THEN
    RAISE EXCEPTION 'Invalid notification type' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (p_user_id, left(p_title, 200), left(p_message, 2000), p_type);
END;
$$;

-- 7.7 submission lifecycle (service_role only) ------------------------------
-- reserve_submission validates EVERYTHING that must hold before code is
-- executed and records the attempt atomically. The profile row is locked
-- (FOR UPDATE) so two concurrent submissions by one user serialise and the
-- attempt limit cannot be raced past.
CREATE OR REPLACE FUNCTION public.reserve_submission(
  p_user_id uuid,
  p_problem_id uuid,
  p_language text,
  p_code text
)
RETURNS TABLE (
  o_submission_id uuid,
  o_competition_id uuid,
  o_attempts_used integer,
  o_attempts_allowed integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.profiles;
  v_problem public.problems;
  v_comp public.competitions;
  v_used integer;
  v_id uuid;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;
  IF NOT v_profile.is_active THEN
    RAISE EXCEPTION 'USER_INACTIVE';
  END IF;
  IF v_profile.role <> 'STUDENT' THEN
    RAISE EXCEPTION 'NOT_A_STUDENT';
  END IF;

  SELECT * INTO v_problem FROM public.problems WHERE id = p_problem_id;
  IF NOT FOUND OR NOT v_problem.is_active THEN
    RAISE EXCEPTION 'PROBLEM_NOT_FOUND';
  END IF;
  IF v_problem.language <> p_language THEN
    RAISE EXCEPTION 'LANGUAGE_MISMATCH';
  END IF;

  SELECT * INTO v_comp FROM public.competitions ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_COMPETITION';
  END IF;
  IF v_comp.status = 'ENDED' OR (v_comp.end_time IS NOT NULL AND now() > v_comp.end_time) THEN
    RAISE EXCEPTION 'COMPETITION_ENDED';
  END IF;
  IF v_comp.status <> 'LIVE' THEN
    RAISE EXCEPTION 'COMPETITION_NOT_LIVE';
  END IF;
  IF v_comp.start_time IS NULL OR v_comp.end_time IS NULL OR now() < v_comp.start_time THEN
    RAISE EXCEPTION 'COMPETITION_NOT_LIVE';
  END IF;

  SELECT COUNT(*) INTO v_used
  FROM public.submissions s
  WHERE s.user_id = p_user_id
    AND s.problem_id = p_problem_id
    AND s.competition_id = v_comp.id;

  IF v_used >= v_comp.maximum_attempts THEN
    RAISE EXCEPTION 'ATTEMPT_LIMIT_REACHED';
  END IF;

  INSERT INTO public.submissions (user_id, problem_id, competition_id, language, code, status)
  VALUES (p_user_id, p_problem_id, v_comp.id, p_language, p_code, 'PENDING')
  RETURNING id INTO v_id;

  UPDATE public.profiles
  SET problems_attempted = problems_attempted + 1
  WHERE id = p_user_id;

  RETURN QUERY SELECT v_id, v_comp.id, v_used + 1, v_comp.maximum_attempts;
END;
$$;

-- finalize_submission stores the verdict, derives the score from the
-- database (problems.max_points; never from the caller) and awards points
-- exactly once per (user, problem) in the same transaction.
CREATE OR REPLACE FUNCTION public.finalize_submission(
  p_submission_id uuid,
  p_status text,
  p_passed_tests integer,
  p_total_tests integer,
  p_execution_time_ms integer,
  p_memory_used_mb numeric,
  p_error_message text
)
RETURNS TABLE (
  o_score integer,
  o_newly_solved boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sub public.submissions;
  v_max_points integer;
  v_rows integer := 0;
  v_new boolean := false;
  v_score integer := 0;
BEGIN
  SELECT * INTO v_sub FROM public.submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;
  IF v_sub.status <> 'PENDING' THEN
    RAISE EXCEPTION 'SUBMISSION_ALREADY_FINALIZED';
  END IF;
  IF p_status NOT IN (
    'ACCEPTED', 'WRONG_ANSWER', 'COMPILATION_ERROR', 'RUNTIME_ERROR',
    'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED'
  ) THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;
  IF p_passed_tests < 0 OR p_total_tests < 0 OR p_passed_tests > p_total_tests THEN
    RAISE EXCEPTION 'INVALID_COUNTS';
  END IF;
  IF p_status = 'ACCEPTED' AND (p_total_tests = 0 OR p_passed_tests <> p_total_tests) THEN
    RAISE EXCEPTION 'INVALID_COUNTS';
  END IF;
  IF p_status <> 'ACCEPTED' AND p_total_tests > 0 AND p_passed_tests = p_total_tests THEN
    RAISE EXCEPTION 'INVALID_COUNTS';
  END IF;

  IF p_status = 'ACCEPTED' THEN
    SELECT max_points INTO v_max_points FROM public.problems WHERE id = v_sub.problem_id;

    INSERT INTO public.solved_problems (user_id, problem_id, score)
    VALUES (v_sub.user_id, v_sub.problem_id, COALESCE(v_max_points, 0))
    ON CONFLICT (user_id, problem_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 1 THEN
      v_new := true;
      v_score := COALESCE(v_max_points, 0);

      UPDATE public.profiles
      SET total_points = total_points + v_score,
          problems_solved = problems_solved + 1
      WHERE id = v_sub.user_id;

      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        v_sub.user_id,
        'Solution Accepted',
        'All test cases passed! +' || v_score || ' points awarded.',
        'SUCCESS'
      );
    END IF;
  END IF;

  -- submissions.score = points awarded BY this submission, so
  -- SUM(submissions.score) always equals the points on the leaderboard.
  UPDATE public.submissions
  SET status = p_status,
      score = v_score,
      passed_tests = p_passed_tests,
      total_tests = p_total_tests,
      execution_time_ms = p_execution_time_ms,
      memory_used_mb = p_memory_used_mb,
      error_message = left(p_error_message, 2000)
  WHERE id = p_submission_id;

  RETURN QUERY SELECT v_score, v_new;
END;
$$;

-- void_submission: used when the evaluator itself is unavailable, so the
-- student is not charged an attempt for a failure that is not theirs.
CREATE OR REPLACE FUNCTION public.void_submission(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
BEGIN
  DELETE FROM public.submissions
  WHERE id = p_submission_id AND status = 'PENDING'
  RETURNING user_id INTO v_user;

  IF FOUND THEN
    UPDATE public.profiles
    SET problems_attempted = GREATEST(problems_attempted - 1, 0)
    WHERE id = v_user;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 8. student-facing problem view (no hidden tests, ever)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.student_problems;
CREATE VIEW public.student_problems
WITH (security_barrier = true) AS
SELECT
  p.id,
  p.title,
  p.description,
  p.difficulty,
  p.max_points,
  p.time_limit_ms,
  p.memory_limit_mb,
  p.language,
  p.buggy_code,
  p.expected_behavior,
  p.input_format,
  p.output_format,
  p.constraints,
  p.sample_input,
  p.sample_output,
  COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'input', e.t ->> 'input',
               'expected_output', e.t ->> 'expected_output'
             ) ORDER BY e.ord)
    FROM jsonb_array_elements(p.test_cases) WITH ORDINALITY AS e(t, ord)
    WHERE COALESCE((e.t ->> 'is_hidden')::boolean, false) = false
  ), '[]'::jsonb) AS sample_test_cases,
  p.problem_order,
  p.round_number,
  p.is_active,
  p.created_at,
  p.updated_at
FROM public.problems p
WHERE p.is_active AND public.is_active_user();

-- ---------------------------------------------------------------------
-- 9. Row Level Security + table privileges
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solved_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.problems FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.competitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.submissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.solved_problems FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.student_problems FROM PUBLIC, anon, authenticated;

-- profiles: read own (admin: all); students may change ONLY full_name.
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY profiles_update_own_name ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) AND public.is_active_user())
  WITH CHECK (id = (SELECT auth.uid()));

-- problems: admin only (students use the student_problems view).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.problems TO authenticated;

CREATE POLICY problems_admin_all ON public.problems
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.student_problems TO authenticated;

-- competitions: any active user reads; only admins write.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitions TO authenticated;

CREATE POLICY competitions_select_active ON public.competitions
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY competitions_admin_insert ON public.competitions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY competitions_admin_update ON public.competitions
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY competitions_admin_delete ON public.competitions
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- submissions: read-only for clients. Writes happen only through
-- reserve_submission / finalize_submission (service_role).
GRANT SELECT ON public.submissions TO authenticated;

CREATE POLICY submissions_select_own_or_admin ON public.submissions
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (user_id = (SELECT auth.uid()) OR public.is_admin())
  );

-- solved_problems: read-only for clients.
GRANT SELECT ON public.solved_problems TO authenticated;

CREATE POLICY solved_problems_select_own_or_admin ON public.solved_problems
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (user_id = (SELECT auth.uid()) OR public.is_admin())
  );

-- notifications: read own; mark own as read (only is_read is updatable).
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

CREATE POLICY notifications_select_own_or_admin ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_admin());

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------
-- 10. Function privileges: deny by default, then grant explicitly
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- used inside RLS policies / CHECK constraints => the caller needs EXECUTE
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_test_cases(jsonb) TO authenticated, service_role;

-- RPCs that perform their own authorisation (auth.uid() / is_admin())
GRANT EXECUTE ON FUNCTION public.get_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_rank(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_competition(text, text, timestamptz, timestamptz, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_competition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_competition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text) TO authenticated;

-- sign-up pre-check (boolean only)
GRANT EXECUTE ON FUNCTION public.student_id_available(text) TO anon, authenticated;

-- scoring path: ONLY the Edge Function's service-role client
GRANT EXECUTE ON FUNCTION public.reserve_submission(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_submission(uuid, text, integer, integer, integer, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_submission(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 11. Realtime publication (idempotent)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['competitions', 'submissions', 'solved_problems', 'problems', 'profiles', 'notifications']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
