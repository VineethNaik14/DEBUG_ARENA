// DEBUG ARENA — sandbox client and judging logic.
//
// Pure TypeScript with no Deno-specific APIs so it can be unit-tested with
// Node (see judge.test.ts). Student code is NEVER executed here: it is sent
// to the configured Piston-compatible execution service (EXECUTION_SERVICE_URL),
// which provides the actual isolation, time limit and memory limit.

export type Language = "python" | "cpp" | "java";

export const LANGUAGES: Record<Language, { language: string; version: string; filename: string }> = {
  // "*" lets the execution service pick whichever runtime version it has installed.
  python: { language: "python", version: "*", filename: "main.py" },
  cpp: { language: "c++", version: "*", filename: "main.cpp" },
  java: { language: "java", version: "*", filename: "Main.java" },
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LANGUAGES, value);
}

export interface TestCase {
  input: string;
  expected_output: string;
  is_hidden: boolean;
}

export type CaseStatus =
  | "PASSED"
  | "WRONG_ANSWER"
  | "COMPILATION_ERROR"
  | "RUNTIME_ERROR"
  | "TIME_LIMIT_EXCEEDED"
  | "MEMORY_LIMIT_EXCEEDED";

export type SubmissionStatus = "ACCEPTED" | Exclude<CaseStatus, "PASSED">;

export interface CaseResult {
  index: number;
  hidden: boolean;
  status: CaseStatus;
  passed: boolean;
  input: string;
  expected_output: string;
  actual_output: string;
  stderr: string;
  error: string | null;
  execution_time_ms: number | null;
  memory_used_mb: number | null;
}

export interface JudgeSummary {
  status: SubmissionStatus;
  passed_tests: number;
  total_tests: number;
  compilation_error: string | null;
  max_execution_time_ms: number | null;
  max_memory_used_mb: number | null;
  results: CaseResult[];
}

export interface ExecutionConfig {
  url: string;
  token?: string;
  /** Upper bound the execution service accepts for run_timeout (Piston default: 3000). */
  maxRunTimeoutMs: number;
  compileTimeoutMs: number;
  fetchImpl?: typeof fetch;
  /** Delay between retries; injectable for tests. */
  retryDelayMs?: number;
}

export interface Limits {
  timeLimitMs: number;
  memoryLimitMb: number;
}

/** The execution service could not be used (down, rejected us, bad response). Not the student's fault. */
export class ExecutionServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionServiceError";
  }
}

/** The problem's stored test cases are not in the expected shape. */
export class MalformedTestCasesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedTestCasesError";
  }
}

const MAX_TEXT = 4000;

export function truncate(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

/** Normalise line endings and trailing whitespace; interior whitespace is significant. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

export function parseTestCases(raw: unknown): TestCase[] {
  if (!Array.isArray(raw)) {
    throw new MalformedTestCasesError("test_cases is not an array");
  }
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new MalformedTestCasesError(`test case ${i + 1} is not an object`);
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.input !== "string" || typeof rec.expected_output !== "string") {
      throw new MalformedTestCasesError(`test case ${i + 1} needs string input and expected_output`);
    }
    if (rec.is_hidden !== undefined && typeof rec.is_hidden !== "boolean") {
      throw new MalformedTestCasesError(`test case ${i + 1} has a non-boolean is_hidden`);
    }
    return { input: rec.input, expected_output: rec.expected_output, is_hidden: rec.is_hidden === true };
  });
}

// ---------------------------------------------------------------------------
// Execution service (Piston-compatible) client
// ---------------------------------------------------------------------------

interface PistonStage {
  stdout?: string;
  stderr?: string;
  output?: string;
  code?: number | null;
  signal?: string | null;
  message?: string | null;
  status?: string | null;
  cpu_time?: number | null;
  wall_time?: number | null;
  memory?: number | null;
}

interface PistonResponse {
  compile?: PistonStage;
  run?: PistonStage;
  message?: string;
}

export type ExecutionOutcome =
  | { kind: "compile_error"; message: string; timeMs: number }
  | {
    kind: "completed";
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    timeMs: number;
    /** true when timeMs was reported by the sandbox (not just our network round trip) */
    timeMeasured: boolean;
    memoryMb: number | null;
  };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function executeOnce(
  cfg: ExecutionConfig,
  language: Language,
  code: string,
  stdin: string,
  limits: Limits,
): Promise<ExecutionOutcome> {
  const mapping = LANGUAGES[language];
  const doFetch = cfg.fetchImpl ?? fetch;
  const runTimeout = Math.min(Math.max(Math.round(limits.timeLimitMs), 100), cfg.maxRunTimeoutMs);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.token) headers.Authorization = cfg.token;

  const body = JSON.stringify({
    language: mapping.language,
    version: mapping.version,
    files: [{ name: mapping.filename, content: code }],
    stdin,
    run_timeout: runTimeout,
    compile_timeout: cfg.compileTimeoutMs,
    run_memory_limit: Math.round(limits.memoryLimitMb * 1024 * 1024),
  });

  const started = performance.now();
  let response: Response | null = null;
  let lastProblem = "no response";
  const attempts = 3;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      response = await doFetch(cfg.url, { method: "POST", headers, body });
    } catch (err) {
      response = null;
      lastProblem = `network error: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (response && response.ok) break;

    if (response) {
      lastProblem = `HTTP ${response.status}`;
      // 401/403 = we are not allowed to use this service; 400 = our request is invalid
      // for this instance (e.g. run_timeout above its cap). Retrying cannot help.
      if (response.status !== 429 && response.status < 500) {
        const detail = await response.text().catch(() => "");
        throw new ExecutionServiceError(`execution service rejected the request (${response.status}): ${truncate(detail, 300)}`);
      }
    }

    if (attempt < attempts) await sleep((cfg.retryDelayMs ?? 700) * attempt);
    response = null;
  }

  if (!response) {
    throw new ExecutionServiceError(`execution service unavailable (${lastProblem})`);
  }

  let result: PistonResponse;
  try {
    result = (await response.json()) as PistonResponse;
  } catch {
    throw new ExecutionServiceError("execution service returned a non-JSON response");
  }

  const roundTripMs = Math.round(performance.now() - started);

  if (result.compile && result.compile.code !== 0 && result.compile.code !== undefined) {
    const text = result.compile.stderr || result.compile.output || result.compile.stdout || "Compilation failed";
    return { kind: "compile_error", message: truncate(text), timeMs: roundTripMs };
  }
  if (result.compile && result.compile.signal) {
    return { kind: "compile_error", message: truncate(result.compile.stderr || "Compilation was terminated"), timeMs: roundTripMs };
  }

  if (!result.run || typeof result.run !== "object") {
    throw new ExecutionServiceError(`execution service returned no run result${result.message ? `: ${truncate(result.message, 200)}` : ""}`);
  }

  const run = result.run;
  const wall = num(run.wall_time);
  const cpu = num(run.cpu_time);
  const memBytes = num(run.memory);

  return {
    kind: "completed",
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    exitCode: typeof run.code === "number" ? run.code : null,
    signal: run.signal ?? null,
    timedOut: run.status === "TO",
    timeMs: Math.round(wall ?? cpu ?? roundTripMs),
    timeMeasured: wall !== null || cpu !== null,
    memoryMb: memBytes === null ? null : Math.round((memBytes / (1024 * 1024)) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

export function classify(outcome: Extract<ExecutionOutcome, { kind: "completed" }>, expected: string, limits: Limits): {
  status: CaseStatus;
  error: string | null;
} {
  const tle = { status: "TIME_LIMIT_EXCEEDED" as const, error: `Time limit exceeded (${limits.timeLimitMs} ms)` };

  if (outcome.timedOut) return tle;
  // Only trust the elapsed time for a verdict when the sandbox measured it;
  // our own round trip includes network latency and compilation.
  if (outcome.timeMeasured && outcome.timeMs > limits.timeLimitMs) return tle;

  if (outcome.memoryMb !== null && outcome.memoryMb > limits.memoryLimitMb) {
    return { status: "MEMORY_LIMIT_EXCEEDED", error: `Memory limit exceeded (${limits.memoryLimitMb} MB)` };
  }

  if (outcome.signal === "SIGKILL") {
    // Older execution services report a timeout only as SIGKILL. If the
    // process ran for (about) the whole limit it was the timer; otherwise the
    // sandbox killed it for exceeding memory.
    if (outcome.timeMs >= limits.timeLimitMs * 0.9) return tle;
    return { status: "MEMORY_LIMIT_EXCEEDED", error: `Process was killed (memory limit ${limits.memoryLimitMb} MB)` };
  }

  if (outcome.signal || (outcome.exitCode !== null && outcome.exitCode !== 0)) {
    const reason = outcome.signal ? `terminated by ${outcome.signal}` : `exited with code ${outcome.exitCode}`;
    return { status: "RUNTIME_ERROR", error: `Runtime error: program ${reason}` };
  }

  if (normalizeOutput(outcome.stdout) === normalizeOutput(expected)) {
    return { status: "PASSED", error: null };
  }
  return { status: "WRONG_ANSWER", error: "Wrong answer" };
}

export async function judge(
  cfg: ExecutionConfig,
  language: Language,
  code: string,
  tests: TestCase[],
  limits: Limits,
  options: { deadlineMs?: number } = {},
): Promise<JudgeSummary> {
  const startedAt = Date.now();
  // The sandbox cannot run longer than its own cap, so judge against that.
  const effective: Limits = {
    timeLimitMs: Math.min(limits.timeLimitMs, cfg.maxRunTimeoutMs),
    memoryLimitMb: limits.memoryLimitMb,
  };
  const results: CaseResult[] = [];
  let maxTime: number | null = null;
  let maxMem: number | null = null;

  for (let i = 0; i < tests.length; i++) {
    if (options.deadlineMs !== undefined && Date.now() - startedAt > options.deadlineMs) {
      throw new ExecutionServiceError("evaluation exceeded the overall time budget");
    }

    const tc = tests[i];
    const outcome = await executeOnce(cfg, language, code, tc.input, effective);

    if (outcome.kind === "compile_error") {
      // A compile error is independent of the test case: stop here.
      return {
        status: "COMPILATION_ERROR",
        passed_tests: 0,
        total_tests: tests.length,
        compilation_error: outcome.message,
        max_execution_time_ms: null,
        max_memory_used_mb: null,
        results: [],
      };
    }

    const verdict = classify(outcome, tc.expected_output, effective);
    maxTime = Math.max(maxTime ?? 0, outcome.timeMs);
    if (outcome.memoryMb !== null) maxMem = Math.max(maxMem ?? 0, outcome.memoryMb);

    results.push({
      index: i,
      hidden: tc.is_hidden,
      status: verdict.status,
      passed: verdict.status === "PASSED",
      input: tc.input,
      expected_output: tc.expected_output,
      actual_output: truncate(outcome.stdout),
      stderr: truncate(outcome.stderr),
      error: verdict.error,
      execution_time_ms: outcome.timeMs,
      memory_used_mb: outcome.memoryMb,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  const firstFailure = results.find((r) => !r.passed);

  return {
    status: firstFailure ? (firstFailure.status as SubmissionStatus) : "ACCEPTED",
    passed_tests: passed,
    total_tests: tests.length,
    compilation_error: null,
    max_execution_time_ms: maxTime,
    max_memory_used_mb: maxMem,
    results,
  };
}

/**
 * What a student may be told about a failed SUBMIT. Hidden test inputs,
 * expected outputs, actual outputs and stderr are never included.
 */
export function submitFeedback(summary: JudgeSummary): string | null {
  if (summary.status === "ACCEPTED") return null;
  if (summary.status === "COMPILATION_ERROR") return summary.compilation_error;

  const failure = summary.results.find((r) => !r.passed);
  if (!failure) return null;

  if (failure.hidden) {
    return `${failure.error ?? "Failed"} on a hidden test case.`;
  }
  const detail = failure.stderr.trim() ? `\n${failure.stderr.trim()}` : "";
  return `${failure.error ?? "Failed"} on sample test case ${failure.index + 1}.${detail}`;
}
