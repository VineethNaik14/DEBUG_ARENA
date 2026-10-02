// Run with:  npx tsx supabase/functions/evaluate-code/judge.test.ts
// Uses a fake Piston server; no network or Supabase needed.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ExecutionServiceError, judge, normalizeOutput, parseTestCases, submitFeedback,
  MalformedTestCasesError, type ExecutionConfig,
} from "./judge.ts";

type Handler = (body: any, headers: Record<string, any>, n: number) => { status?: number; json?: unknown };
let handler: Handler = () => ({ json: {} });
let calls = 0;
let lastHeaders: Record<string, any> = {};

const server = createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    calls++;
    lastHeaders = req.headers;
    const out = handler(JSON.parse(data || "{}"), req.headers, calls);
    res.writeHead(out.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out.json ?? {}));
  });
});
await new Promise<void>((r) => server.listen(0, r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2/execute`;
const cfg = (extra: Partial<ExecutionConfig> = {}): ExecutionConfig =>
  ({ url, maxRunTimeoutMs: 3000, compileTimeoutMs: 10000, retryDelayMs: 1, ...extra });
const limits = { timeLimitMs: 2000, memoryLimitMb: 256 };
const run = (o: Partial<{ stdout: string; stderr: string; code: number; signal: string | null; status: string | null; wall_time: number; memory: number }> = {}) =>
  ({ run: { stdout: "", stderr: "", code: 0, signal: null, status: null, wall_time: 50, memory: 10 * 1048576, ...o } });
const tests = [
  { input: "1", expected_output: "2", is_hidden: false },
  { input: "5", expected_output: "10", is_hidden: true },
];
let passed = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  calls = 0;
  try { await fn(); passed++; console.log("ok  -", name); }
  catch (e) { console.error("FAIL-", name, e); process.exitCode = 1; }
}

await t("normalizeOutput", () => {
  assert.equal(normalizeOutput("a  \r\nb\n\n"), "a\nb");
  assert.notEqual(normalizeOutput(" a"), normalizeOutput("a"));
});

await t("all tests pass -> ACCEPTED, sends stdin/limits/token, no fake pass", async () => {
  handler = (b) => ({ json: run({ stdout: String(Number(b.stdin) * 2) + "\n" }) });
  const s = await judge(cfg({ token: "sekret" }), "python", "print()", tests, limits);
  assert.equal(s.status, "ACCEPTED");
  assert.equal(s.passed_tests, 2);
  assert.equal(lastHeaders.authorization, "sekret");
  assert.equal(s.max_memory_used_mb, 10);
});

await t("wrong answer on hidden test -> no leak in feedback", async () => {
  handler = (b) => ({ json: run({ stdout: b.stdin === "1" ? "2" : "999" }) });
  const s = await judge(cfg(), "python", "x", tests, limits);
  assert.equal(s.status, "WRONG_ANSWER");
  assert.equal(s.passed_tests, 1);
  const fb = submitFeedback(s)!;
  assert.match(fb, /hidden test case/);
  assert.ok(!fb.includes("999") && !fb.includes("10"));
});

await t("unexecuted/empty output is NOT correct", async () => {
  handler = () => ({ json: run({ stdout: "" }) });
  assert.equal((await judge(cfg(), "python", "x", tests, limits)).status, "WRONG_ANSWER");
});

await t("compile error", async () => {
  handler = () => ({ json: { compile: { code: 1, stderr: "main.cpp:1: error: boom", stdout: "", output: "" }, run: { code: null } } });
  const s = await judge(cfg(), "cpp", "x", tests, limits);
  assert.equal(s.status, "COMPILATION_ERROR");
  assert.match(s.compilation_error!, /boom/);
  assert.equal(calls, 1);
});

await t("runtime error (exit code, stderr ignored when exit 0)", async () => {
  handler = () => ({ json: run({ code: 1, stderr: "Traceback" }) });
  assert.equal((await judge(cfg(), "python", "x", tests, limits)).status, "RUNTIME_ERROR");
  handler = (b) => ({ json: run({ stdout: String(Number(b.stdin) * 2), stderr: "warning: deprecated" }) });
  assert.equal((await judge(cfg(), "python", "x", tests, limits)).status, "ACCEPTED");
});

await t("timeout via status TO and via SIGKILL at limit; MLE via SIGKILL early", async () => {
  handler = () => ({ json: run({ status: "TO", signal: "SIGKILL", wall_time: 2000 }) });
  assert.equal((await judge(cfg(), "python", "x", tests, limits)).status, "TIME_LIMIT_EXCEEDED");
  handler = () => ({ json: run({ signal: "SIGKILL", wall_time: 1990 }) });
  assert.equal((await judge(cfg(), "python", "x", tests, limits)).status, "TIME_LIMIT_EXCEEDED");
  handler = () => ({ json: run({ signal: "SIGKILL", wall_time: 100 }) });
  assert.equal((await judge(cfg(), "python", "x", tests, limits)).status, "MEMORY_LIMIT_EXCEEDED");
  handler = (b) => ({ json: run({ stdout: String(Number(b.stdin) * 2), memory: 300 * 1048576 }) });
  assert.equal((await judge(cfg(), "python", "x", tests, limits)).status, "MEMORY_LIMIT_EXCEEDED");
});

await t("slow roundtrip without sandbox timing is not a false TLE", async () => {
  handler = (b) => ({ json: { run: { stdout: String(Number(b.stdin) * 2), stderr: "", code: 0, signal: null } } });
  const s = await judge(cfg(), "python", "x", tests, { timeLimitMs: 1, memoryLimitMb: 256 });
  assert.equal(s.status, "ACCEPTED");
});

await t("service 401 -> ExecutionServiceError (not a compile error), no retry", async () => {
  handler = () => ({ status: 401, json: { message: "Requires authorization" } });
  await assert.rejects(judge(cfg(), "python", "x", tests, limits), ExecutionServiceError);
  assert.equal(calls, 1);
});

await t("429 then success is retried", async () => {
  handler = (b, _h, n) => n < 3 ? { status: 429, json: {} } : { json: run({ stdout: String(Number(b.stdin) * 2) }) };
  assert.equal((await judge(cfg(), "python", "x", [tests[0]], limits)).status, "ACCEPTED");
  assert.equal(calls, 3);
});

await t("service down -> ExecutionServiceError", async () => {
  await assert.rejects(judge(cfg({ url: "http://127.0.0.1:1/execute" }), "python", "x", tests, limits), ExecutionServiceError);
});

await t("run_timeout clamped to service cap", async () => {
  let seen = 0;
  handler = (b) => { seen = b.run_timeout; return { json: run({ stdout: "2" }) }; };
  await judge(cfg({ maxRunTimeoutMs: 3000 }), "python", "x", [tests[0]], { timeLimitMs: 9000, memoryLimitMb: 64 });
  assert.equal(seen, 3000);
});

await t("parseTestCases rejects malformed", () => {
  assert.throws(() => parseTestCases("x"), MalformedTestCasesError);
  assert.throws(() => parseTestCases([{ input: 1, expected_output: "a" }]), MalformedTestCasesError);
  assert.deepEqual(parseTestCases([{ input: "", expected_output: "a" }]), [{ input: "", expected_output: "a", is_hidden: false }]);
});

server.close();
console.log(`${passed} tests passed`);
