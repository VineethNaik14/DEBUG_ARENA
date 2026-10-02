import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Send, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentCompetition } from '@/hooks/useCurrentCompetition';
import { difficultyColor, getLanguageLabel, getMonacoLanguage } from '@/utils/helpers';
import type { StudentProblem, RunCodeResult, SubmitCodeResult } from '@/types';

/**
 * Calls the evaluate-code Edge Function. Only the problem id, code, and
 * language are ever sent to the server — the server looks up everything
 * else it needs (test cases, time/memory limits, point value, competition
 * state, attempt counts) itself, from the authoritative database records.
 * The client never sends — and the server never trusts — a score, a
 * user id, or a "points" value.
 */
async function callEvaluateFunction<T>(action: 'run' | 'submit', problemId: string, code: string, language: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evaluate-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, problemId, code, language }),
  });

  const data: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = (data as { error?: string }).error;
    throw new Error(message || `Request failed (${response.status})`);
  }

  return data as T;
}

export function ProblemWorkspace() {
  const { problemId } = useParams<{ problemId: string }>();
  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();
  const [problem, setProblem] = useState<StudentProblem | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [runResult, setRunResult] = useState<RunCodeResult | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitCodeResult | null>(null);
  const { status: competitionStatus } = useCurrentCompetition();
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProblem() {
      if (!problemId) return;
      const { data, error } = await supabase
        .from('student_problems')
        .select('*')
        .eq('id', problemId)
        .maybeSingle();

      if (error || !data) {
        setError('Problem not found');
        setLoading(false);
        return;
      }

      const prob = data as unknown as StudentProblem;
      setProblem(prob);
      // Start the editor with the buggy code the student needs to fix
      setCode(prob.buggy_code || '');
      setLoading(false);
    }
    void fetchProblem();
  }, [problemId]);

  const runCode = useCallback(async () => {
    if (!problem || !code) return;
    setRunning(true);
    setRunResult(null);
    setError(null);

    try {
      const data = await callEvaluateFunction<RunCodeResult>('run', problem.id, code, problem.language);
      setRunResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run code');
    } finally {
      setRunning(false);
    }
  }, [problem, code]);

  const submitCode = useCallback(async () => {
    if (!problem || !code || !profile) return;
    setSubmitting(true);
    setSubmitResult(null);
    setError(null);

    try {
      // The Edge Function does everything server-side: authenticates the
      // user from the bearer token, re-fetches the problem/competition/
      // attempt state from the database, executes the code in the sandbox,
      // computes the score from `problems.max_points`, inserts the
      // submission row, and (if newly solved) awards points atomically.
      // Nothing about the result is trusted from — or written by — the
      // client.
      const data = await callEvaluateFunction<SubmitCodeResult>('submit', problem.id, code, problem.language);
      setSubmitResult(data);
      // Points / counters changed on the server; pull the new profile.
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit code');
    } finally {
      setSubmitting(false);
    }
  }, [problem, code, profile, refreshProfile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-arena-accent animate-spin" />
      </div>
    );
  }

  if (error && !problem) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-10 h-10 text-arena-error mx-auto mb-3" />
        <p className="text-arena-subtle">{error}</p>
        <button onClick={() => navigate('/student/problems')} className="btn-secondary mt-4">
          Back to Problems
        </button>
      </div>
    );
  }

  if (!problem) return null;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/student/problems')} className="text-arena-muted hover:text-arena-text transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-lg font-bold text-arena-text">{problem.title}</h1>
              <span className={`badge ${difficultyColor(problem.difficulty)}`}>{problem.difficulty}</span>
            </div>
            <p className="text-sm text-arena-subtle">
              {problem.max_points} points · {problem.time_limit_ms}ms time limit · {getLanguageLabel(problem.language)}
            </p>
          </div>
        </div>
      </div>

      {competitionStatus !== 'LIVE' && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>The competition is not live — you can run code on the samples, but submissions are closed.</span>
        </div>
      )}

      {/* Split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Problem description */}
        <div className="glass-card p-5 overflow-y-auto max-h-[calc(100vh-220px)]">
          <h2 className="text-arena-text font-semibold mb-3">Problem Description</h2>
          <p className="text-sm text-arena-subtle leading-relaxed whitespace-pre-wrap mb-4">{problem.description}</p>

          {problem.expected_behavior && (
            <>
              <h3 className="text-arena-text font-semibold text-sm mb-2">Expected Behavior</h3>
              <p className="text-sm text-arena-subtle leading-relaxed whitespace-pre-wrap mb-4">{problem.expected_behavior}</p>
            </>
          )}

          {problem.constraints && (
            <>
              <h3 className="text-arena-text font-semibold text-sm mb-2">Constraints</h3>
              <p className="text-sm text-arena-subtle leading-relaxed whitespace-pre-wrap mb-4">{problem.constraints}</p>
            </>
          )}

          <h3 className="text-arena-text font-semibold text-sm mb-2">Sample Test Cases</h3>
          <div className="space-y-2">
            {(problem.sample_test_cases || []).map((tc, i) => (
              <div key={i} className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                <p className="text-xs text-arena-muted mb-1">Test Case {i + 1}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-arena-muted">Input</p>
                    <pre className="text-arena-text font-mono text-xs mt-1 whitespace-pre-wrap">{tc.input}</pre>
                  </div>
                  <div>
                    <p className="text-xs text-arena-muted">Expected Output</p>
                    <pre className="text-arena-text font-mono text-xs mt-1 whitespace-pre-wrap">{tc.expected_output}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Code editor */}
        <div className="glass-card flex flex-col max-h-[calc(100vh-220px)]">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-arena-border">
            <span className="text-sm text-arena-text font-medium">{getLanguageLabel(problem.language)}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={runCode}
                disabled={running}
                className="btn-secondary text-sm flex items-center gap-1.5 py-1.5"
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Run Code
              </button>
              <button
                onClick={submitCode}
                disabled={submitting || competitionStatus !== 'LIVE'}
                title={competitionStatus !== 'LIVE' ? 'Submissions are open only while the competition is live' : undefined}
                className="btn-primary text-sm flex items-center gap-1.5 py-1.5"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Submit
              </button>
            </div>
          </div>

          {/* Monaco editor */}
          <div className="flex-1 min-h-[300px]">
            <Editor
              height="100%"
              language={getMonacoLanguage(problem.language)}
              value={code}
              onChange={(val) => setCode(val || '')}
              theme="vs-dark"
              options={{
                fontSize: 14,
                fontFamily: 'JetBrains Mono, monospace',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 12, bottom: 12 },
                lineNumbers: 'on',
                tabSize: 4,
                wordWrap: 'on',
              }}
            />
          </div>

          {/* Results panel */}
          {(runResult || submitResult || error) && (
            <div className="border-t border-arena-border p-4 max-h-[250px] overflow-y-auto">
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-arena-error/10 border border-arena-error/30 text-sm text-arena-error">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Run results */}
              {runResult && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-arena-text flex items-center gap-2">
                    <Play className="w-4 h-4" /> Run Results
                  </h4>
                  {runResult.compilation_error && (
                    <div className="p-3 rounded-lg bg-arena-error/10 border border-arena-error/30">
                      <pre className="text-xs text-arena-error font-mono whitespace-pre-wrap">{runResult.compilation_error}</pre>
                    </div>
                  )}
                  {!runResult.compilation_error && runResult.results.map((res) => (
                    <div key={res.index} className="p-2.5 rounded-lg bg-arena-bg/50 border border-arena-border space-y-1.5">
                      <div className="flex items-center gap-2">
                        {res.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}
                        <span className="text-sm text-arena-text">Test Case {res.index + 1}</span>
                        {!res.passed && <span className="text-xs text-rose-400">{res.error ?? res.status.replace(/_/g, ' ')}</span>}
                        {res.execution_time_ms !== null && (
                          <span className="text-xs text-arena-muted ml-auto">
                            {res.execution_time_ms}ms{res.memory_used_mb !== null ? ` · ${res.memory_used_mb}MB` : ''}
                          </span>
                        )}
                      </div>
                      {!res.passed && (
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <div>
                            <p className="text-arena-muted font-sans">Expected</p>
                            <pre className="whitespace-pre-wrap text-arena-text">{res.expected_output}</pre>
                          </div>
                          <div>
                            <p className="text-arena-muted font-sans">Your output</p>
                            <pre className="whitespace-pre-wrap text-arena-text">{res.actual_output}</pre>
                          </div>
                          {res.stderr.trim() && (
                            <div className="col-span-2">
                              <p className="text-arena-muted font-sans">stderr</p>
                              <pre className="whitespace-pre-wrap text-rose-400">{res.stderr}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Submit results */}
              {submitResult && (
                <div className="space-y-2">
                  <div className={`flex items-center gap-3 p-4 rounded-lg ${
                    submitResult.status === 'ACCEPTED'
                      ? 'bg-emerald-500/10 border border-emerald-500/30'
                      : 'bg-rose-500/10 border border-rose-500/30'
                  }`}>
                    {submitResult.status === 'ACCEPTED' ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    ) : (
                      <XCircle className="w-6 h-6 text-rose-400" />
                    )}
                    <div>
                      <p className={`font-semibold ${submitResult.status === 'ACCEPTED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {submitResult.status === 'ACCEPTED' ? 'Solution Accepted' : submitResult.status.replace(/_/g, ' ')}
                      </p>
                      <p className="text-sm text-arena-subtle">
                        {submitResult.passed_tests} / {submitResult.total_tests} test cases passed
                      </p>
                      {submitResult.status === 'ACCEPTED' && (
                        <p className="text-sm text-emerald-400 font-medium mt-1">
                          {submitResult.newly_solved ? `+${submitResult.score} Points` : 'Already solved earlier — no additional points'}
                        </p>
                      )}
                      {submitResult.error_message && (
                        <pre className="text-xs text-rose-400 font-mono mt-2 whitespace-pre-wrap">{submitResult.error_message}</pre>
                      )}
                      <p className="text-xs text-arena-muted mt-1">
                        Attempt {submitResult.attempts_used} of {submitResult.attempts_allowed}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}