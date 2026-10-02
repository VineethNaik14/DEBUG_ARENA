import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Edit2, Trash2, X, Code2, Loader2, AlertCircle, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { difficultyColor } from '@/utils/helpers';
import type { Problem, ProblemDifficulty, SupportedLanguage } from '@/types';
import type { Json } from '@/types/supabase';

const SAMPLE_TEST_CASES = JSON.stringify(
  [
    { input: '5', expected_output: '15', is_hidden: false },
    { input: '100', expected_output: '5050', is_hidden: true },
  ],
  null,
  2,
);

/** Validates the admin's JSON and returns the exact structure stored in problems.test_cases. */
function parseTestCasesInput(raw: string): Json[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Test cases must be valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Test cases must be a non-empty JSON array.');
  }

  const out: Json[] = [];
  parsed.forEach((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Test case ${i + 1} must be an object.`);
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.input !== 'string' || typeof rec.expected_output !== 'string') {
      throw new Error(`Test case ${i + 1} needs string "input" and "expected_output" (use "" for no input).`);
    }
    if (rec.is_hidden !== undefined && typeof rec.is_hidden !== 'boolean') {
      throw new Error(`Test case ${i + 1}: "is_hidden" must be true or false.`);
    }
    out.push({ input: rec.input, expected_output: rec.expected_output, is_hidden: rec.is_hidden === true });
  });

  if (out.length > 30) throw new Error('At most 30 test cases are supported.');
  if (!out.some((tc) => typeof tc === 'object' && tc !== null && !Array.isArray(tc) && tc.is_hidden === false)) {
    throw new Error('Add at least one sample test case ("is_hidden": false) so students can use Run Code.');
  }
  return out;
}

export function AdminProblems() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    difficulty: 'EASY' as ProblemDifficulty,
    max_points: 100,
    time_limit_ms: 2000,
    memory_limit_mb: 256,
    language: 'python' as SupportedLanguage,
    buggy_code: '',
    expected_behavior: '',
    input_format: '',
    output_format: '',
    constraints: '',
    sample_input: '',
    sample_output: '',
    test_cases: '[]',
    problem_order: 0,
    round_number: 1,
    is_active: true,
  });

  useEffect(() => {
    fetchProblems();
  }, []);

  async function fetchProblems() {
    const { data, error } = await supabase
      .from('problems')
      .select('*')
      .order('problem_order', { ascending: true });

    if (!error && data) setProblems(data as unknown as Problem[]);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      title: '',
      description: '',
      difficulty: 'EASY',
      max_points: 100,
      time_limit_ms: 2000,
      memory_limit_mb: 256,
      language: 'python',
      buggy_code: '',
      expected_behavior: '',
      input_format: '',
      output_format: '',
      constraints: '',
      sample_input: '',
      sample_output: '',
      test_cases: SAMPLE_TEST_CASES,
      problem_order: problems.length + 1,
      round_number: 1,
      is_active: true,
    });
    setShowForm(true);
  }

  function openEdit(problem: Problem) {
    setEditing(problem);
    setForm({
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      max_points: problem.max_points,
      time_limit_ms: problem.time_limit_ms,
      memory_limit_mb: problem.memory_limit_mb,
      language: problem.language,
      buggy_code: problem.buggy_code || '',
      expected_behavior: problem.expected_behavior || '',
      input_format: problem.input_format || '',
      output_format: problem.output_format || '',
      constraints: problem.constraints || '',
      sample_input: problem.sample_input || '',
      sample_output: problem.sample_output || '',
      test_cases: JSON.stringify(
        (problem.test_cases || []).map((tc) => ({ input: tc.input, expected_output: tc.expected_output, is_hidden: tc.is_hidden === true })),
        null,
        2,
      ),
      problem_order: problem.problem_order,
      round_number: problem.round_number || 1,
      is_active: problem.is_active,
    });
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const testCases = parseTestCasesInput(form.test_cases);

      const problemData = {
        title: form.title.trim(),
        description: form.description,
        difficulty: form.difficulty,
        max_points: form.max_points,
        time_limit_ms: form.time_limit_ms,
        memory_limit_mb: form.memory_limit_mb,
        language: form.language,
        buggy_code: form.buggy_code,
        expected_behavior: form.expected_behavior,
        input_format: form.input_format,
        output_format: form.output_format,
        constraints: form.constraints,
        sample_input: form.sample_input,
        sample_output: form.sample_output,
        test_cases: testCases,
        is_active: form.is_active,
        problem_order: form.problem_order,
        round_number: form.round_number,
      };

      if (!problemData.title) throw new Error('Title is required.');

      // One atomic write: test cases live in problems.test_cases.
      if (editing) {
        const { data, error: updateError } = await supabase.from('problems').update(problemData).eq('id', editing.id).select('id');
        if (updateError) throw new Error(updateError.message);
        if (!data || data.length === 0) throw new Error('The problem was not updated (admin permission required, or it no longer exists).');
      } else {
        const { error: insertError } = await supabase.from('problems').insert(problemData);
        if (insertError) throw new Error(insertError.message);
      }

      setShowForm(false);
      void fetchProblems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save problem');
    } finally {
      setSaving(false);
    }
  }

  async function deleteProblem(problem: Problem) {
    if (!confirm(`Delete "${problem.title}"? This cannot be undone.`)) return;
    setError(null);
    const { error: deleteError } = await supabase.from('problems').delete().eq('id', problem.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    void fetchProblems();
  }

  async function toggleActive(problem: Problem) {
    setError(null);
    const { error: updateError } = await supabase.from('problems').update({ is_active: !problem.is_active }).eq('id', problem.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    void fetchProblems();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-arena-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-arena-text">Problems</h1>
          <p className="text-sm text-arena-subtle mt-1">Create and manage debugging problems</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Problem
        </button>
      </div>

      {error && !showForm && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-arena-error/10 border border-arena-error/30 text-sm text-arena-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-6">
        {problems.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <Code2 className="w-10 h-10 text-arena-muted mx-auto mb-3" />
            <p className="text-arena-subtle mb-2">No problems yet</p>
            <button onClick={openCreate} className="text-sm text-arena-accent hover:underline">
              Create your first problem
            </button>
          </div>
        ) : (
          [1, 2, 3].map((round) => {
            const roundProblems = problems.filter(p => (p.round_number || 1) === round);
            if (roundProblems.length === 0) return null;
            return (
              <div key={round} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-arena-accent" />
                  <h3 className="text-sm font-semibold text-arena-text">Round {round}</h3>
                  <span className="text-xs text-arena-muted">({roundProblems.length} problem{roundProblems.length > 1 ? 's' : ''})</span>
                </div>
                {roundProblems.map((problem, i) => (
                  <div key={problem.id} className="glass-card p-4 flex items-center justify-between gap-4 animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-arena-muted font-mono">#{problem.problem_order}</span>
                        <span className={`badge ${difficultyColor(problem.difficulty)}`}>{problem.difficulty}</span>
                        <span className="text-xs text-arena-muted">{problem.max_points} pts</span>
                        {!problem.is_active && (
                          <span className="badge border-rose-500/30 bg-rose-500/10 text-rose-400">Inactive</span>
                        )}
                      </div>
                      <h3 className="text-arena-text font-semibold">{problem.title}</h3>
                      <p className="text-sm text-arena-subtle truncate mt-0.5">{problem.language?.toUpperCase()}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => toggleActive(problem)} className="p-1.5 rounded-lg hover:bg-arena-accent/10 text-arena-muted hover:text-arena-accent transition-colors text-xs">
                        {problem.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => openEdit(problem)} className="p-1.5 rounded-lg hover:bg-arena-accent/10 text-arena-muted hover:text-arena-accent transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteProblem(problem)} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-arena-muted hover:text-rose-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Problem form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="glass-card max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-arena-text">{editing ? 'Edit Problem' : 'Create Problem'}</h3>
              <button onClick={() => setShowForm(false)} className="text-arena-muted hover:text-arena-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-arena-error/10 border border-arena-error/30 text-sm text-arena-error">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-arena-subtle mb-1.5">Title</label>
                <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input-field" required />
              </div>

              <div>
                <label className="block text-sm text-arena-subtle mb-1.5">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input-field min-h-[100px] resize-y" required />
              </div>

              <div>
                <label className="block text-sm text-arena-subtle mb-1.5">Buggy Code</label>
                <textarea value={form.buggy_code} onChange={(e) => setForm({ ...form, buggy_code: e.target.value })} className="input-field font-mono text-xs min-h-[100px] resize-y" required />
              </div>

              <div>
                <label className="block text-sm text-arena-subtle mb-1.5">Expected Behavior</label>
                <textarea value={form.expected_behavior} onChange={(e) => setForm({ ...form, expected_behavior: e.target.value })} className="input-field min-h-[80px] resize-y" required />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Difficulty</label>
                  <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as ProblemDifficulty })} className="input-field">
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HARD">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Points</label>
                  <input type="number" value={form.max_points} onChange={(e) => setForm({ ...form, max_points: parseInt(e.target.value) || 0 })} className="input-field" />
                </div>
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Time Limit (ms)</label>
                  <input type="number" value={form.time_limit_ms} onChange={(e) => setForm({ ...form, time_limit_ms: parseInt(e.target.value) || 0 })} className="input-field" />
                </div>
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Memory Limit (MB)</label>
                  <input type="number" value={form.memory_limit_mb} onChange={(e) => setForm({ ...form, memory_limit_mb: parseInt(e.target.value) || 0 })} className="input-field" />
                </div>
              </div>

              <div>
                <label className="block text-sm text-arena-subtle mb-1.5">Language</label>
                <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as SupportedLanguage })} className="input-field">
                  <option value="python">Python</option>
                  <option value="cpp">C++</option>
                  <option value="java">Java</option>
                </select>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Input Format</label>
                  <textarea value={form.input_format} onChange={(e) => setForm({ ...form, input_format: e.target.value })} className="input-field text-xs min-h-[60px] resize-y" />
                </div>
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Output Format</label>
                  <textarea value={form.output_format} onChange={(e) => setForm({ ...form, output_format: e.target.value })} className="input-field text-xs min-h-[60px] resize-y" />
                </div>
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Sample Input</label>
                  <textarea value={form.sample_input} onChange={(e) => setForm({ ...form, sample_input: e.target.value })} className="input-field font-mono text-xs min-h-[60px] resize-y" />
                </div>
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Sample Output</label>
                  <textarea value={form.sample_output} onChange={(e) => setForm({ ...form, sample_output: e.target.value })} className="input-field font-mono text-xs min-h-[60px] resize-y" />
                </div>
              </div>

              <div>
                <label className="block text-sm text-arena-subtle mb-1.5">Constraints</label>
                <textarea value={form.constraints} onChange={(e) => setForm({ ...form, constraints: e.target.value })} className="input-field text-xs min-h-[60px] resize-y" />
              </div>

              <div>
                <label className="block text-sm text-arena-subtle mb-1.5">Test Cases (JSON)</label>
                <textarea
                  value={form.test_cases}
                  onChange={(e) => setForm({ ...form, test_cases: e.target.value })}
                  className="input-field font-mono text-xs min-h-[160px] resize-y"
                  spellCheck={false}
                />
                <p className="text-xs text-arena-muted mt-1">
                  Array of {'{'}"input", "expected_output", "is_hidden"{'}'}. Cases with "is_hidden": false are shown to students and used by Run Code;
                  hidden cases are used only for grading and are never sent to students.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Round</label>
                  <select value={form.round_number} onChange={(e) => setForm({ ...form, round_number: parseInt(e.target.value) || 1 })} className="input-field">
                    <option value={1}>Round 1</option>
                    <option value={2}>Round 2</option>
                    <option value={3}>Round 3</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Problem Order</label>
                  <input type="number" value={form.problem_order} onChange={(e) => setForm({ ...form, problem_order: parseInt(e.target.value) || 0 })} className="input-field" />
                </div>
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Active</label>
                  <select value={form.is_active ? 'true' : 'false'} onChange={(e) => setForm({ ...form, is_active: e.target.value === 'true' })} className="input-field">
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>

              <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? 'Saving...' : editing ? 'Update Problem' : 'Create Problem'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}