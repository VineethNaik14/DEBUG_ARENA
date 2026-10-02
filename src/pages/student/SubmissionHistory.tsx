import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCode2, Clock, Cpu, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { statusColor, getLanguageLabel, formatRelativeTime } from '@/utils/helpers';
import type { Submission } from '@/types';

export function SubmissionHistory() {
  const { profile } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSub, setSelectedSub] = useState<Submission | null>(null);

  useEffect(() => {
    async function fetchSubmissions() {
      if (!profile) return;
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setSubmissions(data as Submission[]);
      }
      setLoading(false);
    }
    fetchSubmissions();

    const channel = supabase
      .channel('submission-history')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions', filter: `user_id=eq.${profile?.id}` }, () => fetchSubmissions())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `user_id=eq.${profile?.id}` }, () => fetchSubmissions())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-arena-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-arena-text">My Submissions</h1>
        <p className="text-sm text-arena-subtle mt-1">View your submission history and results</p>
      </div>

      {submissions.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <FileCode2 className="w-10 h-10 text-arena-muted mx-auto mb-3" />
          <p className="text-arena-subtle mb-2">No submissions yet</p>
          <Link to="/student/problems" className="text-sm text-arena-accent hover:underline">
            Start solving problems
          </Link>
        </div>
      ) : (
        <>
          <div className="glass-card overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-arena-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Language</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Tests</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Score</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider hidden md:table-cell">Exec Time</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Submitted</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr
                    key={sub.id}
                    className="border-b border-arena-border last:border-0 hover:bg-arena-surface/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedSub(sub)}
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm text-arena-text font-medium">{getLanguageLabel(sub.language)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${statusColor(sub.status)}`}>
                        {sub.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-arena-text">{sub.passed_tests}/{sub.total_tests}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-amber-400">{sub.score}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-sm text-arena-subtle">{sub.execution_time_ms ? `${sub.execution_time_ms}ms` : 'N/A'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm text-arena-muted">{formatRelativeTime(sub.created_at)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-4 h-4 text-arena-muted" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Submission detail modal */}
          {selectedSub && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelectedSub(null)}>
              <div className="glass-card max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-arena-text">Submission Details</h3>
                  <button onClick={() => setSelectedSub(null)} className="text-arena-muted hover:text-arena-text">
                    <ChevronRight className="w-5 h-5 rotate-90" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                    <p className="text-xs text-arena-muted">Language</p>
                    <p className="text-sm text-arena-text font-medium">{getLanguageLabel(selectedSub.language)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                    <p className="text-xs text-arena-muted">Status</p>
                    <span className={`badge ${statusColor(selectedSub.status)}`}>{selectedSub.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                    <p className="text-xs text-arena-muted">Test Cases</p>
                    <p className="text-sm text-arena-text font-medium">{selectedSub.passed_tests}/{selectedSub.total_tests}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                    <p className="text-xs text-arena-muted">Score</p>
                    <p className="text-sm font-bold text-amber-400">{selectedSub.score} pts</p>
                  </div>
                  <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                    <p className="text-xs text-arena-muted flex items-center gap-1"><Clock className="w-3 h-3" /> Execution Time</p>
                    <p className="text-sm text-arena-text">{selectedSub.execution_time_ms ? `${selectedSub.execution_time_ms}ms` : 'N/A'}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                    <p className="text-xs text-arena-muted flex items-center gap-1"><Cpu className="w-3 h-3" /> Memory</p>
                    <p className="text-sm text-arena-text">{selectedSub.memory_used_mb ? `${selectedSub.memory_used_mb}MB` : 'N/A'}</p>
                  </div>
                </div>

                {selectedSub.error_message && (
                  <div className="mb-4">
                    <p className="text-xs text-arena-muted mb-1">Error Message</p>
                    <pre className="p-3 rounded-lg bg-arena-error/5 border border-arena-error/30 text-xs text-arena-error font-mono whitespace-pre-wrap overflow-x-auto">{selectedSub.error_message}</pre>
                  </div>
                )}

                <div>
                  <p className="text-xs text-arena-muted mb-1">Submitted Code</p>
                  <pre className="p-3 rounded-lg bg-arena-bg border border-arena-border text-xs text-arena-text font-mono whitespace-pre-wrap overflow-x-auto max-h-[300px]">{selectedSub.code}</pre>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
