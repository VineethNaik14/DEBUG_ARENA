// DEBUG ARENA — evaluate-code Edge Function (the ONLY code evaluator).
//
//   POST { action: "run" | "submit", problemId, code, language }
//   POST { action: "health" }                       (admins only)
//
// Security model
//   * The caller is identified ONLY from the bearer token (auth.getUser()).
//     No user id, score, points, status or test data is read from the body.
//   * Problems, test cases, limits, point values and the competition state
//     are read from the database with the service-role key.
//   * Student code is never executed in this runtime: it is sent to the
//     sandbox configured by EXECUTION_SERVICE_URL (Piston-compatible).
//   * Hidden tests are executed here but never returned to the client.
//   * Attempt limits, competition window, active-user checks and scoring are
//     enforced inside Postgres (reserve_submission / finalize_submission).
//
// Required secret:   EXECUTION_SERVICE_URL   e.g. https://piston.example.com/api/v2/execute
// Optional secrets:  EXECUTION_SERVICE_TOKEN (sent as Authorization header)
//                    EXECUTION_MAX_RUN_TIMEOUT_MS (default 3000 = Piston default cap)
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type ExecutionConfig,
  ExecutionServiceError,
  isLanguage,
  type JudgeSummary,
  judge,
  MalformedTestCasesError,
  parseTestCases,
  type TestCase,
  submitFeedback,
} from "./judge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_CODE_CHARS = 50_000;
const MAX_TESTS = 30;
const JUDGE_BUDGET_MS = 110_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, code: string, error: string): Response {
  return json({ error, code }, status);
}

// Exceptions raised by reserve_submission -> HTTP responses.
const RESERVE_ERRORS: Record<string, { status: number; code: string; error: string }> = {
  PROFILE_NOT_FOUND: { status: 403, code: "FORBIDDEN", error: "Your profile could not be found." },
  USER_INACTIVE: { status: 403, code: "USER_INACTIVE", error: "Your account has been deactivated." },
  NOT_A_STUDENT: { status: 403, code: "FORBIDDEN", error: "Only students can submit solutions." },
  PROBLEM_NOT_FOUND: { status: 404, code: "PROBLEM_NOT_FOUND", error: "Problem not found." },
  LANGUAGE_MISMATCH: { status: 400, code: "LANGUAGE_MISMATCH", error: "That language is not allowed for this problem." },
  NO_COMPETITION: { status: 403, code: "NO_COMPETITION", error: "There is no competition to submit to." },
  COMPETITION_NOT_LIVE: { status: 403, code: "COMPETITION_NOT_LIVE", error: "The competition is not live." },
  COMPETITION_ENDED: { status: 403, code: "COMPETITION_ENDED", error: "The competition has ended." },
  ATTEMPT_LIMIT_REACHED: {
    status: 403,
    code: "ATTEMPT_LIMIT_REACHED",
    error: "You have used all allowed attempts for this problem.",
  },
};

const EVALUATOR_UNAVAILABLE =
  "Code execution is temporarily unavailable. Your attempt was not counted — please try again shortly.";
const MISCONFIGURED = "This problem is misconfigured. Please tell an administrator.";

function executionConfig(): ExecutionConfig | null {
  const url = Deno.env.get("EXECUTION_SERVICE_URL")?.trim();
  if (!url) return null;
  const maxRun = Number(Deno.env.get("EXECUTION_MAX_RUN_TIMEOUT_MS") ?? "3000");
  return {
    url,
    token: Deno.env.get("EXECUTION_SERVICE_TOKEN")?.trim() || undefined,
    maxRunTimeoutMs: Number.isFinite(maxRun) && maxRun >= 100 ? maxRun : 3000,
    compileTimeoutMs: 10_000,
  };
}

function evaluatorFailure(err: unknown): Response {
  if (err instanceof ExecutionServiceError) {
    console.error(`evaluate-code: ${err.message}`);
    return fail(503, "EVALUATOR_UNAVAILABLE", EVALUATOR_UNAVAILABLE);
  }
  throw err;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("evaluate-code: Supabase environment is incomplete");
    return fail(500, "SERVER_MISCONFIGURED", "Server is misconfigured.");
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "INVALID_JSON", "Request body must be a JSON object.");
  }

  const action = body.action;
  if (action !== "run" && action !== "submit" && action !== "health") {
    return fail(400, "INVALID_ACTION", "action must be 'run', 'submit' or 'health'.");
  }

  // ---- authenticate (identity comes ONLY from the token) ------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "UNAUTHORIZED", "Missing Authorization header.");

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return fail(401, "UNAUTHORIZED", "Invalid or expired session.");
  const userId = authData.user.id;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("evaluate-code: profile lookup failed", profileError.message);
      return fail(500, "DATABASE_ERROR", "Could not verify your account.");
    }
    if (!profile) return fail(403, "FORBIDDEN", "Your profile could not be found.");
    if (!profile.is_active) return fail(403, "USER_INACTIVE", "Your account has been deactivated.");

    const config = executionConfig();

    if (action === "health") {
      if (profile.role !== "ADMIN") return fail(403, "FORBIDDEN", "Admins only.");
      return await health(config);
    }

    // ---- validate input ---------------------------------------------------
    const { problemId, code, language } = body;

    if (typeof problemId !== "string" || !UUID_RE.test(problemId)) {
      return fail(400, "INVALID_PROBLEM", "A valid problemId is required.");
    }
    if (typeof code !== "string" || code.trim().length === 0) {
      return fail(400, "EMPTY_CODE", "Code must not be empty.");
    }
    if (code.length > MAX_CODE_CHARS) {
      return fail(413, "CODE_TOO_LARGE", `Code must be at most ${MAX_CODE_CHARS} characters.`);
    }
    if (!isLanguage(language)) {
      return fail(400, "INVALID_LANGUAGE", "Unsupported language. Use python, cpp or java.");
    }

    // ---- load the problem (service role: hidden tests included) -------------
    const { data: problem, error: problemError } = await admin
      .from("problems")
      .select("id, language, time_limit_ms, memory_limit_mb, test_cases, is_active")
      .eq("id", problemId)
      .maybeSingle();

    if (problemError) {
      console.error("evaluate-code: problem lookup failed", problemError.message);
      return fail(500, "DATABASE_ERROR", "Could not load the problem.");
    }
    if (!problem || (!problem.is_active && profile.role !== "ADMIN")) {
      return fail(404, "PROBLEM_NOT_FOUND", "Problem not found.");
    }
    if (problem.language !== language) {
      return fail(400, "LANGUAGE_MISMATCH", `This problem must be solved in ${problem.language}.`);
    }

    let allTests: TestCase[];
    try {
      allTests = parseTestCases(problem.test_cases);
    } catch (err) {
      if (err instanceof MalformedTestCasesError) {
        console.error(`evaluate-code: problem ${problemId} has malformed test cases: ${err.message}`);
        return fail(500, "PROBLEM_MISCONFIGURED", MISCONFIGURED);
      }
      throw err;
    }
    if (allTests.length > MAX_TESTS) {
      console.error(`evaluate-code: problem ${problemId} has ${allTests.length} test cases (max ${MAX_TESTS})`);
      return fail(500, "PROBLEM_MISCONFIGURED", MISCONFIGURED);
    }

    const limits = { timeLimitMs: problem.time_limit_ms as number, memoryLimitMb: problem.memory_limit_mb as number };

    if (!config) {
      console.error("evaluate-code: EXECUTION_SERVICE_URL is not set");
      return fail(503, "EVALUATOR_UNAVAILABLE", EVALUATOR_UNAVAILABLE);
    }

    // =====================================================================
    // RUN — sample (non-hidden) tests only; never recorded or scored
    // =====================================================================
    if (action === "run") {
      const samples = allTests.filter((t) => !t.is_hidden);
      if (samples.length === 0) {
        return fail(422, "NO_SAMPLE_TESTS", "This problem has no sample test cases to run against.");
      }

      let summary: JudgeSummary;
      try {
        summary = await judge(config, language, code, samples, limits, { deadlineMs: JUDGE_BUDGET_MS });
      } catch (err) {
        return evaluatorFailure(err);
      }

      return json({
        status: summary.status,
        all_passed: summary.status === "ACCEPTED",
        passed_tests: summary.passed_tests,
        total_tests: summary.total_tests,
        compilation_error: summary.compilation_error,
        max_execution_time_ms: summary.max_execution_time_ms,
        max_memory_used_mb: summary.max_memory_used_mb,
        results: summary.results.map((r) => ({
          index: r.index,
          passed: r.passed,
          status: r.status,
          input: r.input,
          expected_output: r.expected_output,
          actual_output: r.actual_output,
          stderr: r.stderr,
          error: r.error,
          execution_time_ms: r.execution_time_ms,
          memory_used_mb: r.memory_used_mb,
        })),
      });
    }

    // =====================================================================
    // SUBMIT — authoritative, server-scored
    // =====================================================================
    if (profile.role !== "STUDENT") {
      return fail(403, "FORBIDDEN", "Only students can submit solutions.");
    }
    if (allTests.length === 0) {
      console.error(`evaluate-code: problem ${problemId} has no test cases`);
      return fail(500, "PROBLEM_MISCONFIGURED", MISCONFIGURED);
    }

    // 1. Validate competition window / attempt limit / user state and record the attempt (atomic).
    const { data: reserved, error: reserveError } = await admin.rpc("reserve_submission", {
      p_user_id: userId,
      p_problem_id: problemId,
      p_language: language,
      p_code: code,
    });

    if (reserveError) {
      const known = RESERVE_ERRORS[reserveError.message];
      if (known) return fail(known.status, known.code, known.error);
      console.error("evaluate-code: reserve_submission failed", reserveError.message);
      return fail(500, "DATABASE_ERROR", "Could not record your submission.");
    }
    const reservation = Array.isArray(reserved) ? reserved[0] : reserved;
    if (!reservation) {
      console.error("evaluate-code: reserve_submission returned no row");
      return fail(500, "DATABASE_ERROR", "Could not record your submission.");
    }
    const submissionId = reservation.o_submission_id as string;

    // 2. Execute against ALL tests (public + hidden) in the sandbox.
    let summary: JudgeSummary;
    try {
      summary = await judge(config, language, code, allTests, limits, { deadlineMs: JUDGE_BUDGET_MS });
    } catch (err) {
      // Not the student's fault: release the attempt.
      const { error: voidError } = await admin.rpc("void_submission", { p_submission_id: submissionId });
      if (voidError) console.error("evaluate-code: void_submission failed", voidError.message);
      return evaluatorFailure(err);
    }

    // 3. Persist the verdict; the database derives the score and awards points once.
    const feedback = submitFeedback(summary);
    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_submission", {
      p_submission_id: submissionId,
      p_status: summary.status,
      p_passed_tests: summary.passed_tests,
      p_total_tests: summary.total_tests,
      p_execution_time_ms: summary.max_execution_time_ms,
      p_memory_used_mb: summary.max_memory_used_mb,
      p_error_message: feedback,
    });

    if (finalizeError) {
      console.error("evaluate-code: finalize_submission failed", finalizeError.message);
      const { error: voidError } = await admin.rpc("void_submission", { p_submission_id: submissionId });
      if (voidError) console.error("evaluate-code: void_submission failed", voidError.message);
      return fail(500, "DATABASE_ERROR", "Your code was evaluated but the result could not be saved. Please submit again.");
    }
    const outcome = Array.isArray(finalized) ? finalized[0] : finalized;

    return json({
      submission_id: submissionId,
      status: summary.status,
      passed_tests: summary.passed_tests,
      total_tests: summary.total_tests,
      score: outcome?.o_score ?? 0,
      newly_solved: outcome?.o_newly_solved ?? false,
      execution_time_ms: summary.max_execution_time_ms,
      memory_used_mb: summary.max_memory_used_mb,
      error_message: feedback,
      attempts_used: reservation.o_attempts_used,
      attempts_allowed: reservation.o_attempts_allowed,
    });
  } catch (err) {
    console.error("evaluate-code: unexpected error", err);
    return fail(500, "INTERNAL_ERROR", "Internal server error.");
  }
});

async function health(config: ExecutionConfig | null): Promise<Response> {
  if (!config) {
    return json({
      ok: false,
      configured: false,
      detail: "EXECUTION_SERVICE_URL is not set. Run: supabase secrets set EXECUTION_SERVICE_URL=https://<your-piston>/api/v2/execute",
      languages: {},
    });
  }

  const runtimesUrl = config.url.replace(/\/execute\/?$/, "/runtimes");
  const headers: Record<string, string> = {};
  if (config.token) headers.Authorization = config.token;

  try {
    const res = await fetch(runtimesUrl, { headers });
    if (!res.ok) {
      return json({ ok: false, configured: true, detail: `Execution service answered HTTP ${res.status} for ${runtimesUrl}`, languages: {} });
    }
    const runtimes = (await res.json()) as Array<{ language: string; version: string; aliases?: string[] }>;
    const wanted: Record<string, string> = { python: "python", cpp: "c++", java: "java" };
    const languages: Record<string, string | null> = {};
    for (const [key, name] of Object.entries(wanted)) {
      const found = runtimes.find((r) => r.language === name || r.aliases?.includes(name));
      languages[key] = found ? found.version : null;
    }
    const ok = Object.values(languages).every((v) => v !== null);
    return json({
      ok,
      configured: true,
      detail: ok ? "Execution service is reachable and has all runtimes." : "Execution service is reachable but is missing runtimes.",
      languages,
    });
  } catch (err) {
    return json({
      ok: false,
      configured: true,
      detail: `Could not reach the execution service: ${err instanceof Error ? err.message : String(err)}`,
      languages: {},
    });
  }
}
