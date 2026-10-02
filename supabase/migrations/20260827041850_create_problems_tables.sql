/*
# Create problems and problem_hidden_test_cases tables

1. New Tables
   - `problems`
     - `id` (uuid, primary key)
     - `title` (text, not null) — problem name
     - `description` (text, not null) — full problem statement
     - `difficulty` (text) — EASY, MEDIUM, or HARD
     - `points` (integer) — points awarded for solving (default by difficulty)
     - `time_limit` (integer, default 2000) — execution time limit in ms
     - `memory_limit` (integer, default 256) — memory limit in MB
     - `supported_languages` (text[]) — languages allowed (cpp, java, python)
     - `starter_code` (jsonb) — per-language starter code snippets
     - `public_test_cases` (jsonb) — visible test cases for "Run Code"
     - `is_active` (boolean, default true) — admin can deactivate
     - `problem_order` (integer, default 0) — display ordering
     - `created_at`, `updated_at` (timestamptz)
   - `problem_hidden_test_cases`
     - `id` (uuid, primary key)
     - `problem_id` (uuid, FK to problems, ON DELETE CASCADE)
     - `test_case` (jsonb) — { input, expected_output, is_hidden }
     - `created_at` (timestamptz)

2. Security
   - RLS on `problems`: students can SELECT active problems only; admins have full CRUD.
   - RLS on `problem_hidden_test_cases`: students have NO access at all (no SELECT policy); only admins and SECURITY DEFINER functions can read.
   - Hidden test cases are stored separately so they can never leak to the frontend.

3. Important Notes
   - The `problem_hidden_test_cases` table has NO student-facing SELECT policy, ensuring hidden tests are invisible to students.
   - Only the edge function (using service role) and admin users can access hidden test cases.
*/

CREATE TABLE IF NOT EXISTS public.problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  difficulty text DEFAULT 'EASY' CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  points integer DEFAULT 100,
  time_limit integer DEFAULT 2000,
  memory_limit integer DEFAULT 256,
  supported_languages text[] DEFAULT ARRAY['python', 'cpp', 'java'],
  starter_code jsonb DEFAULT '{}',
  public_test_cases jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  problem_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.problems ENABLE ROW LEVEL SECURITY;

-- Students can read active problems; admins can read all
DROP POLICY IF EXISTS "select_active_problems_student" ON public.problems;
CREATE POLICY "select_active_problems_student" ON public.problems
  FOR SELECT TO authenticated
  USING (is_active = true OR public.is_admin());

-- Admins have full CRUD on problems
DROP POLICY IF EXISTS "admin_insert_problems" ON public.problems;
CREATE POLICY "admin_insert_problems" ON public.problems
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_problems" ON public.problems;
CREATE POLICY "admin_update_problems" ON public.problems
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_problems" ON public.problems;
CREATE POLICY "admin_delete_problems" ON public.problems
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Hidden test cases table (separate from problems for security)
CREATE TABLE IF NOT EXISTS public.problem_hidden_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  test_case jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.problem_hidden_test_cases ENABLE ROW LEVEL SECURITY;

-- Only admins can manage hidden test cases; students have NO policy (no access)
DROP POLICY IF EXISTS "admin_select_hidden_tests" ON public.problem_hidden_test_cases;
CREATE POLICY "admin_select_hidden_tests" ON public.problem_hidden_test_cases
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_hidden_tests" ON public.problem_hidden_test_cases;
CREATE POLICY "admin_insert_hidden_tests" ON public.problem_hidden_test_cases
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_hidden_tests" ON public.problem_hidden_test_cases;
CREATE POLICY "admin_update_hidden_tests" ON public.problem_hidden_test_cases
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_hidden_tests" ON public.problem_hidden_test_cases;
CREATE POLICY "admin_delete_hidden_tests" ON public.problem_hidden_test_cases
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- updated_at trigger for problems
DROP TRIGGER IF EXISTS problems_updated_at ON public.problems;
CREATE TRIGGER problems_updated_at
  BEFORE UPDATE ON public.problems
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Index for problem ordering
CREATE INDEX IF NOT EXISTS idx_problems_order ON public.problems(problem_order);
CREATE INDEX IF NOT EXISTS idx_problems_active ON public.problems(is_active);
CREATE INDEX IF NOT EXISTS idx_hidden_tests_problem_id ON public.problem_hidden_test_cases(problem_id);
