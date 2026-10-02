import { useEffect, useState } from 'react';
import { Search, FileCode2, X, Clock, Cpu, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { statusColor, getLanguageLabel, formatRelativeTime } from '@/utils/helpers';
import type { Submission } from '@/types';

interface SubmissionWithRelations extends Submission {
  profiles?: { full_name: string; student_id: string | null } | null;
  problems?: { title: string } | null;
}

export function AdminSubmissions() {
  const [submissions, setSubmissions] = useState<SubmissionWithRelations[]>([]);
  const [filtered, setFiltered] = useState<SubmissionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedSub, setSelectedSub] = useState<SubmissionWithRelations | null>(null);

  useEffect(() => {
    async function fetchSubmissions() {
      const { data, error } = await supabase
        .from('submissions')
        .select(`
          *,
          profiles:user_id (full_name, student_id),
          problems:problem_id (title)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!error && data) {
        setSubmissions(data as unknown as SubmissionWithRelations[]);
        setFiltered(data as unknown as SubmissionWithRelations[]);
      }
      setLoading(false);
    }
    fetchSubmissions();

    const channel = supabase
      .channel('admin-submissions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions' }, () => fetchSubmissions())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions' }, () => fetchSubmissions())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    let result = submissions;
    if (statusFilter !== 'ALL') {
      result = result.filter(s => s.status === statusFilter);
    }
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((s) =>
        s.profiles?.full_name?.toLowerCase().includes(lower) ||
        s.profiles?.student_id?.toLowerCase().includes(lower) ||
        s.problems?.title?.toLowerCase().includes(lower)
      );
    }
    setFiltered(result);
  }, [search, statusFilter, submissions]);

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
        <h1 className="text-2xl font-bold text-arena-text">Submissions</h1>
        <p className="text-sm text-arena-subtle mt-1">Monitor all student submissions</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arena-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-10"
            placeholder="Search by student or problem..."
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field sm:w-48">
          <option value="ALL">All Statuses</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="WRONG_ANSWER">Wrong Answer</option>
          <option value="COMPILATION_ERROR">Compilation Error</option>
          <option value="RUNTIME_ERROR">Runtime Error</option>
          <option value="TIME_LIMIT_EXCEEDED">Time Limit Exceeded</option>
          <option value="PENDING">Pending</option>
        </select>
      </div>

      {/* Submissions table */}
      <div className="glass-card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-arena-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Student</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider hidden md:table-cell">Problem</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Lang</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Status</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Tests</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Score</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider hidden lg:table-cell">Time</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <FileCode2 className="w-8 h-8 text-arena-muted mx-auto mb-2" />
                  <p className="text-sm text-arena-subtle">No submissions found</p>
                </td>
              </tr>
            ) : (
              filtered.map((sub) => (
                <tr key={sub.id} className="border-b border-arena-border last:border-0 hover:bg-arena-surface/50 cursor-pointer transition-colors" onClick={() => setSelectedSub(sub)}>
                  <td className="px-4 py-3">
                    <p className="text-sm text-arena-text font-medium">{sub.profiles?.full_name || 'Unknown'}</p>
                    <p className="text-xs text-arena-muted">{sub.profiles?.student_id || ''}</p>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-sm text-arena-subtle">{sub.problems?.title || 'N/A'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-arena-text">{getLanguageLabel(sub.language)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${statusColor(sub.status)}`}>{sub.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm text-arena-text">{sub.passed_tests}/{sub.total_tests}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-amber-400">{sub.score}</span>
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell">
                    <span className="text-sm text-arena-subtle">{sub.execution_time_ms ? `${sub.execution_time_ms}ms` : 'N/A'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-arena-muted">{formatRelativeTime(sub.created_at)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Submission detail modal */}
      {selectedSub && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelectedSub(null)}>
          <div className="glass-card max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-arena-text">Submission Inspection</h3>
              <button onClick={() => setSelectedSub(null)} className="text-arena-muted hover:text-arena-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                <p className="text-xs text-arena-muted">Student</p>
                <p className="text-sm text-arena-text font-medium">{selectedSub.profiles?.full_name}</p>
              </div>
              <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                <p className="text-xs text-arena-muted">Problem</p>
                <p className="text-sm text-arena-text font-medium">{selectedSub.problems?.title}</p>
              </div>
              <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                <p className="text-xs text-arena-muted">Status</p>
                <span className={`badge ${statusColor(selectedSub.status)}`}>{selectedSub.status.replace(/_/g, ' ')}</span>
              </div>
              <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                <p className="text-xs text-arena-muted">Test Cases</p>
                <p className="text-sm text-arena-text">{selectedSub.passed_tests}/{selectedSub.total_tests}</p>
              </div>
              <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                <p className="text-xs text-arena-muted flex items-center gap-1"><Clock className="w-3 h-3" /> Exec Time</p>
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
    </div>
  );
}
