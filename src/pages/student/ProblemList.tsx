import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Code2, ChevronRight, CheckCircle2, Circle, Lock, AlertCircle, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { difficultyColor } from '@/utils/helpers';
import type { StudentProblem } from '@/types';

interface ProblemWithStatus extends StudentProblem {
  status: 'NOT_ATTEMPTED' | 'ATTEMPTED' | 'SOLVED' | 'LOCKED';
}

const ROUNDS = [
  { number: 1, label: 'Round 1', description: 'Warm-up challenges' },
  { number: 2, label: 'Round 2', description: 'Intermediate debugging' },
  { number: 3, label: 'Round 3', description: 'Advanced problem solving' },
];

export function ProblemList() {
  const { profile } = useAuth();
  const [problems, setProblems] = useState<ProblemWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRound, setActiveRound] = useState(1);

  const userId = profile?.id;

  useEffect(() => {
    async function fetchProblems() {
      if (!userId) return;

      const { data: problemsData, error } = await supabase
        .from('student_problems')
        .select('*')
        .order('problem_order', { ascending: true });

      if (error || !problemsData) {
        setLoading(false);
        return;
      }

      const { data: submissions } = await supabase
        .from('submissions')
        .select('problem_id, status')
        .eq('user_id', userId);

      const { data: solved } = await supabase
        .from('solved_problems')
        .select('problem_id')
        .eq('user_id', userId);

      const solvedSet = new Set((solved || []).map(s => s.problem_id));
      const attemptedSet = new Set((submissions || []).map(s => s.problem_id));

      const problemsWithStatus: ProblemWithStatus[] = (problemsData as unknown as StudentProblem[]).map(p => {
        let status: ProblemWithStatus['status'] = 'NOT_ATTEMPTED';
        if (solvedSet.has(p.id)) status = 'SOLVED';
        else if (attemptedSet.has(p.id)) status = 'ATTEMPTED';
        return { ...p, status };
      });

      setProblems(problemsWithStatus);
      setLoading(false);
    }
    void fetchProblems();
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-arena-subtle text-sm">Loading problems...</div>
      </div>
    );
  }

  const roundProblems = problems.filter(p => (p.round_number || 1) === activeRound);
  const availableRounds = ROUNDS.filter(r => problems.some(p => (p.round_number || 1) === r.number));

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-arena-text">Problems</h1>
        <p className="text-sm text-arena-subtle mt-1">Debug the code and submit your solution</p>
      </div>

      {/* Round tabs */}
      {availableRounds.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {availableRounds.map(round => (
            <button
              key={round.number}
              onClick={() => setActiveRound(round.number)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                activeRound === round.number
                  ? 'border-arena-accent bg-arena-accent/10 text-arena-accent'
                  : 'border-arena-border bg-arena-surface text-arena-subtle hover:border-arena-accent/40 hover:text-arena-text'
              }`}
            >
              <Layers className="w-4 h-4" />
              {round.label}
              <span className="text-xs opacity-70">
                ({problems.filter(p => (p.round_number || 1) === round.number).length})
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Round description */}
      {availableRounds.length > 0 && (
        <p className="text-sm text-arena-subtle">
          {ROUNDS.find(r => r.number === activeRound)?.description}
        </p>
      )}

      {problems.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Code2 className="w-10 h-10 text-arena-muted mx-auto mb-3" />
          <p className="text-arena-subtle">No problems available yet. Check back later.</p>
        </div>
      ) : roundProblems.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Layers className="w-10 h-10 text-arena-muted mx-auto mb-3" />
          <p className="text-arena-subtle">No problems in Round {activeRound} yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {roundProblems.map((problem, i) => (
            <Link
              key={problem.id}
              to={`/student/problems/${problem.id}`}
              className="block glass-card p-5 hover:border-arena-accent/40 transition-all duration-200 group animate-slide-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <div className="mt-0.5 shrink-0">
                    {problem.status === 'SOLVED' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                    {problem.status === 'ATTEMPTED' && <AlertCircle className="w-5 h-5 text-amber-400" />}
                    {problem.status === 'NOT_ATTEMPTED' && <Circle className="w-5 h-5 text-arena-muted" />}
                    {problem.status === 'LOCKED' && <Lock className="w-5 h-5 text-arena-muted" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-xs text-arena-muted font-mono">
                        Round {activeRound} · Problem {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className={`badge ${difficultyColor(problem.difficulty)}`}>
                        {problem.difficulty}
                      </span>
                    </div>
                    <h3 className="text-arena-text font-semibold group-hover:text-arena-accent transition-colors">
                      {problem.title}
                    </h3>
                    <div className="flex items-center gap-4 mt-2 text-sm text-arena-subtle">
                      <span>{problem.max_points} points</span>
                      <span>·</span>
                       <span>{problem.language.toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className={`badge ${
                    problem.status === 'SOLVED' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
                    problem.status === 'ATTEMPTED' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' :
                    'border-arena-border bg-arena-surface text-arena-subtle'
                  }`}>
                    {problem.status === 'SOLVED' ? 'Solved' :
                     problem.status === 'ATTEMPTED' ? 'Attempted' :
                     problem.status === 'LOCKED' ? 'Locked' : 'Not Attempted'}
                  </span>
                  <ChevronRight className="w-5 h-5 text-arena-muted group-hover:text-arena-accent transition-colors" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
