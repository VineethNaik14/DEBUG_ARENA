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
