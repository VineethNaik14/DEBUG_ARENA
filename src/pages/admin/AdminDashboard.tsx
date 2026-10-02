import { useEffect, useState } from 'react';
import { Users, Code2, FileCode2, CheckCircle2, TrendingUp, Award, Activity, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { statusColor, competitionStatusColor, formatRelativeTime } from '@/utils/helpers';
import type { Submission, Competition } from '@/types';

interface SubmissionWithRelations extends Submission {
  profiles?: { full_name: string; student_id: string | null } | null;
  problems?: { title: string } | null;
}

export function AdminDashboard() {
  const [stats, setStats] = useState({
    totalStudents: 0,
    activeStudents: 0,
    totalProblems: 0,
    totalSubmissions: 0,
    acceptedSubmissions: 0,
    averageScore: 0,
  });
  const [recentSubmissions, setRecentSubmissions] = useState<SubmissionWithRelations[]>([]);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const [studentsRes, activeStudentsRes, problemsRes, submissionsRes, acceptedRes, avgRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT').eq('is_active', true),
        supabase.from('problems').select('id', { count: 'exact', head: true }),
        supabase.from('submissions').select('id', { count: 'exact', head: true }),
        supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'ACCEPTED'),
        supabase.from('submissions').select('score'),
      ]);

      const avgScore = avgRes.data && avgRes.data.length > 0
        ? Math.round(avgRes.data.reduce((sum, s) => sum + (s.score || 0), 0) / avgRes.data.length)
        : 0;

      setStats({
        totalStudents: studentsRes.count || 0,
        activeStudents: activeStudentsRes.count || 0,
        totalProblems: problemsRes.count || 0,
        totalSubmissions: submissionsRes.count || 0,
        acceptedSubmissions: acceptedRes.count || 0,
        averageScore: avgScore,
      });

      const { data: recent } = await supabase
        .from('submissions')
        .select(`
          *,
          profiles:user_id (full_name, student_id),
          problems:problem_id (title)
        `)
        .order('created_at', { ascending: false })
        .limit(8);

      setRecentSubmissions((recent as unknown as SubmissionWithRelations[]) || []);

      const { data: comp } = await supabase
        .from('competitions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (comp) setCompetition(comp as Competition);
      setLoading(false);
    }
    fetchData();

    const channel = supabase
      .channel('admin-dashboard-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competitions' }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-arena-subtle text-sm">Loading dashboard...</div>
      </div>
    );
  }

  const acceptanceRate = stats.totalSubmissions > 0
    ? Math.round((stats.acceptedSubmissions / stats.totalSubmissions) * 100)
    : 0;

  const statCards = [
    { label: 'Total Students', value: stats.totalStudents, icon: Users, color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/30' },
    { label: 'Active Students', value: stats.activeStudents, icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
    { label: 'Total Problems', value: stats.totalProblems, icon: Code2, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
    { label: 'Total Submissions', value: stats.totalSubmissions, icon: FileCode2, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
    { label: 'Accepted', value: stats.acceptedSubmissions, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
    { label: 'Acceptance Rate', value: `${acceptanceRate}%`, icon: TrendingUp, color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/30' },
    { label: 'Average Score', value: stats.averageScore, icon: Award, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-arena-text">Admin Dashboard</h1>
        <p className="text-sm text-arena-subtle mt-1">Platform overview and statistics</p>
      </div>

      {/* Competition status */}
      {competition && (
        <div className="glass-card p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-arena-accent" />
            <div>
              <p className="text-sm font-medium text-arena-text">{competition.name}</p>
              <p className="text-xs text-arena-muted">Current competition</p>
            </div>
          </div>
          <span className={`badge ${competitionStatusColor(competition.status)}`}>
            {competition.status}
          </span>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <div key={i} className="stat-card p-5 animate-slide-up" style={{ animationDelay: `${i * 40}ms` }}>
            <div className={`w-10 h-10 rounded-lg ${stat.bg} border ${stat.border} flex items-center justify-center mb-3`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <p className="text-2xl font-bold text-arena-text">{stat.value}</p>
            <p className="text-sm text-arena-subtle mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Recent submissions */}
      <div className="glass-card p-5">
        <h3 className="text-arena-text font-semibold mb-4">Recent Submissions</h3>
        {recentSubmissions.length === 0 ? (
          <p className="text-sm text-arena-subtle text-center py-6">No submissions yet</p>
        ) : (
          <div className="space-y-2">
            {recentSubmissions.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-arena-text truncate">
                    {sub.profiles?.full_name || 'Unknown'} · {sub.problems?.title || 'Problem'}
                  </p>
                  <p className="text-xs text-arena-muted">{sub.language.toUpperCase()} · {formatRelativeTime(sub.created_at)}</p>
                </div>
                <span className={`badge ${statusColor(sub.status)}`}>
                  {sub.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
