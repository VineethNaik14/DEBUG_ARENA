/**
 * Shared frontend/application types for DEBUG ARENA.
 *
 * IMPORTANT: This file must contain ONLY frontend type definitions.
 * The Supabase-generated database types live in `src/types/supabase.ts`.
 * Edge Function code lives under `supabase/functions/`.
 */

// ---------------------------------------------------------------------------
// Enums / literal unions
// ---------------------------------------------------------------------------

export type UserRole = 'STUDENT' | 'ADMIN';

export type ProblemDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type SubmissionStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'WRONG_ANSWER'
  | 'COMPILATION_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED';

export type CompetitionStatus = 'UPCOMING' | 'LIVE' | 'ENDED';

export type NotificationType = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export type SupportedLanguage = 'python' | 'cpp' | 'java';

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  full_name: string;
  student_id: string | null;
  email: string;
  role: UserRole;
  is_active: boolean;
  total_points: number;
  problems_solved: number;
  problems_attempted: number;
  created_at: string;
  updated_at: string;
}

/** One entry of `problems.test_cases` (admin view). Hidden cases are never sent to students. */
export interface TestCase {
  input: string;
  expected_output: string;
  is_hidden?: boolean;
}

/** A sample (non-hidden) test case as exposed to students. */
export interface SampleTestCase {
  input: string;
  expected_output: string;
}

/** Full problem row — readable by admins only (contains hidden tests). */
export interface Problem {
  id: string;
  title: string;
  description: string;
  difficulty: ProblemDifficulty;
  max_points: number;
  time_limit_ms: number;
  memory_limit_mb: number;
  language: SupportedLanguage;
  buggy_code: string;
  expected_behavior: string;
  input_format: string;
  output_format: string;
  constraints: string;
  sample_input: string;
  sample_output: string;
  test_cases: TestCase[];
  is_active: boolean;
  problem_order: number;
  round_number: number;
  created_at: string;
  updated_at: string;
}

/** What students receive (from the `student_problems` view): no test_cases, only samples. */
export type StudentProblem = Omit<Problem, 'test_cases'> & {
  sample_test_cases: SampleTestCase[];
};

export interface Submission {
  id: string;
  user_id: string;
  problem_id: string;
  competition_id: string | null;
  code: string;
  language: SupportedLanguage;
  status: SubmissionStatus;
  score: number;
  execution_time_ms: number | null;
  memory_used_mb: number | null;
  passed_tests: number;
  total_tests: number;
  error_message: string | null;
  created_at: string;
}

export interface Competition {
  id: string;
  name: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  status: CompetitionStatus;
  duration: number | null;
  maximum_attempts: number;
  penalty_rules: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  full_name: string;
  student_id: string | null;
  total_points: number;
  problems_solved: number;
  last_solve_time: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: NotificationType;
  is_read: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// evaluate-code Edge Function response shapes
// ---------------------------------------------------------------------------

export type TestCaseVerdict = Exclude<SubmissionStatus, 'PENDING' | 'ACCEPTED'> | 'PASSED';

export interface TestCaseResult {
  index: number;
  passed: boolean;
  status: TestCaseVerdict;
  input: string;
  expected_output: string;
  actual_output: string;
  stderr: string;
  error: string | null;
  execution_time_ms: number | null;
  memory_used_mb: number | null;
}

export interface RunCodeResult {
  status: Exclude<SubmissionStatus, 'PENDING'>;
  all_passed: boolean;
  passed_tests: number;
  total_tests: number;
  compilation_error: string | null;
  max_execution_time_ms: number | null;
  max_memory_used_mb: number | null;
  results: TestCaseResult[];
}

export interface SubmitCodeResult {
  submission_id: string;
  status: Exclude<SubmissionStatus, 'PENDING'>;
  passed_tests: number;
  total_tests: number;
  score: number;
  newly_solved: boolean;
  execution_time_ms: number | null;
  memory_used_mb: number | null;
  error_message: string | null;
  attempts_used: number;
  attempts_allowed: number;
}

export interface EvaluatorError {
  error: string;
  code: string;
}

export interface ExecutionHealth {
  ok: boolean;
  configured: boolean;
  detail: string;
  languages: Record<string, string | null>;
}
