/*
# Create competitions, submissions, solved_problems, and notifications tables

1. New Tables
   - `competitions`
     - `id`, `name`, `description`, `start_time`, `end_time`, `status` (UPCOMING/LIVE/ENDED), `duration`, `maximum_attempts`, `penalty_rules`, `created_at`, `updated_at`
   - `submissions`
     - `id`, `user_id`, `problem_id`, `competition_id`, `language`, `code`, `status`, `test_cases_passed`, `total_test_cases`, `score`, `execution_time`, `memory_used`, `error_message`, `submitted_at`
   - `solved_problems`
     - `id`, `user_id`, `problem_id`, `score`, `solved_at` — UNIQUE(user_id, problem_id)
   - `notifications`
     - `id`, `user_id`, `title`, `message`, `type`, `is_read`, `created_at`

2. Security
   - RLS on all tables.
   - Competitions: students can SELECT; admins have full CRUD.
   - Submissions: students can SELECT/INSERT their own; admins can SELECT all.
   - Solved_problems: students can SELECT their own; admins can SELECT all. No direct INSERT/UPDATE/DELETE from client — handled by SECURITY DEFINER function.
   - Notifications: students can SELECT/UPDATE their own; admins can SELECT all.

3. Important Notes
   - Competition status transitions (UPCOMING → LIVE → ENDED) are managed by admin via a SECURITY DEFINER function.
   - Submissions record the competition_id for attempt-limit validation.
   - solved_problems UNIQUE constraint prevents duplicate point awards.
*/

-- Competitions table
CREATE TABLE IF NOT EXISTS public.competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  start_time timestamptz,
  end_time timestamptz,
  status text DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING', 'LIVE', 'ENDED')),
  duration integer, -- duration in minutes
  maximum_attempts integer DEFAULT 3,
  penalty_rules jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

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

-- Submissions table
CREATE TABLE IF NOT EXISTS public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  problem_id uuid NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  competition_id uuid REFERENCES public.competitions(id) ON DELETE SET NULL,
  language text NOT NULL,
  code text NOT NULL,
  status text DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'WRONG_ANSWER', 'COMPILATION_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED')),
  test_cases_passed integer DEFAULT 0,
  total_test_cases integer DEFAULT 0,
  score integer DEFAULT 0,
  execution_time numeric,
  memory_used numeric,
  error_message text,
  submitted_at timestamptz DEFAULT now()
);

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_submissions" ON public.submissions;
CREATE POLICY "select_own_submissions" ON public.submissions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "insert_own_submissions" ON public.submissions;
CREATE POLICY "insert_own_submissions" ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Index for querying submissions by user and problem
CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON public.submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem_id ON public.submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_competition_id ON public.submissions(competition_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON public.submissions(status);

-- Solved problems table
CREATE TABLE IF NOT EXISTS public.solved_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  problem_id uuid NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,
  score integer DEFAULT 0,
  solved_at timestamptz DEFAULT now(),
  UNIQUE(user_id, problem_id)
);

ALTER TABLE public.solved_problems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_solved" ON public.solved_problems;
CREATE POLICY "select_own_solved" ON public.solved_problems
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

CREATE INDEX IF NOT EXISTS idx_solved_user_id ON public.solved_problems(user_id);
CREATE INDEX IF NOT EXISTS idx_solved_problem_id ON public.solved_problems(problem_id);

-- Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text,
  message text,
  type text DEFAULT 'INFO',
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notifications" ON public.notifications;
CREATE POLICY "select_own_notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "update_own_notifications" ON public.notifications;
CREATE POLICY "update_own_notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON public.notifications;
CREATE POLICY "insert_own_notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);

-- updated_at trigger for competitions
DROP TRIGGER IF EXISTS competitions_updated_at ON public.competitions;
CREATE TRIGGER competitions_updated_at
  BEFORE UPDATE ON public.competitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
