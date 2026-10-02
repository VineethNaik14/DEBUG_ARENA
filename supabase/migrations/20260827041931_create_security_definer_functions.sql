/*
# Create SECURITY DEFINER functions for scoring, leaderboard, and competition management

1. New Functions
   - `award_points(p_user_id, p_problem_id, p_score)` — Awards points for solving a problem. Uses INSERT ... ON CONFLICT to prevent duplicate awards. Updates profile totals atomically.
   - `increment_attempted(p_user_id)` — Increments problems_attempted on profile.
   - `get_leaderboard()` — Returns ranked leaderboard with rank, name, points, problems_solved, solving time.
   - `get_student_rank(p_user_id)` — Returns the current rank of a specific student.
   - `start_competition(p_competition_id)` — Sets competition status to LIVE and records start_time.
   - `end_competition(p_competition_id)` — Sets competition status to ENDED and records end_time.
   - `create_notification(p_user_id, p_title, p_message, p_type)` — Creates a notification for a user.

2. Security
   - All functions are SECURITY DEFINER so they run with the database owner's privileges, bypassing RLS.
   - This allows them to update server-controlled fields (total_points, problems_solved) that students cannot modify directly.
   - Functions validate the caller's identity where appropriate.

3. Important Notes
   - `award_points` uses ON CONFLICT DO NOTHING on the solved_problems unique constraint to prevent double-awarding.
   - Profile totals are updated atomically within the same function.
   - Leaderboard ranking: points DESC, problems_solved DESC, then by earliest solve time ASC.
*/

-- Award points for solving a problem (idempotent via UNIQUE constraint)
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

-- Increment problems_attempted
CREATE OR REPLACE FUNCTION public.increment_attempted(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET problems_attempted = problems_attempted + 1
  WHERE id = p_user_id
    AND id NOT IN (
      SELECT user_id FROM public.solved_problems WHERE problem_id IN (
        SELECT problem_id FROM public.submissions WHERE user_id = p_user_id
      )
    );
END;
$$;

-- Get leaderboard (ranked)
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
    user_id,
    full_name,
    student_id,
    total_points,
    problems_solved,
    first_solve_time
  FROM ranked
  ORDER BY total_points DESC, problems_solved DESC, first_solve_time ASC NULLS LAST;
END;
$$;

-- Get rank for a specific student
CREATE OR REPLACE FUNCTION public.get_student_rank(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_rank integer;
BEGIN
  SELECT rank INTO student_rank
  FROM public.get_leaderboard()
  WHERE user_id = p_user_id;

  RETURN COALESCE(student_rank, 0);
END;
$$;

-- Start competition (admin only)
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
      end_time = COALESCE(end_time, now() + (duration || ' minutes')::interval)
  WHERE id = p_competition_id;
END;
$$;

-- End competition (admin only)
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

-- Create notification for a user
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

-- Grant execute on these functions to authenticated users
GRANT EXECUTE ON FUNCTION public.award_points(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_attempted(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_rank(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_competition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_competition(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
