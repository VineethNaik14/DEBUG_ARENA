import { useEffect, useState } from 'react';
import { TrendingUp, BarChart3, Activity, Code2, Award, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalSubmissions: 0,
    accepted: 0,
    wrongAnswer: 0,
    compilationError: 0,
    runtimeError: 0,
    tle: 0,
    languageUsage: { python: 0, cpp: 0, java: 0 } as Record<string, number>,
    dailyActivity: [] as { date: string; count: number }[],
  });

  useEffect(() => {
    async function fetchAnalytics() {
      const { data: submissions } = await supabase.from('submissions').select('status, language, created_at');

      if (submissions) {
        const langUsage: Record<string, number> = { python: 0, cpp: 0, java: 0 };
        const dailyMap: Record<string, number> = {};

        submissions.forEach((s) => {
          if (langUsage[s.language] !== undefined) langUsage[s.language]++;
          const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          dailyMap[date] = (dailyMap[date] || 0) + 1;
        });

        const dailyActivity = Object.entries(dailyMap).map(([date, count]) => ({ date, count })).slice(-10);

        setStats({
          totalSubmissions: submissions.length,
          accepted: submissions.filter((s) => s.status === 'ACCEPTED').length,
          wrongAnswer: submissions.filter((s) => s.status === 'WRONG_ANSWER').length,
          compilationError: submissions.filter((s) => s.status === 'COMPILATION_ERROR').length,
          runtimeError: submissions.filter((s) => s.status === 'RUNTIME_ERROR').length,
          tle: submissions.filter((s) => s.status === 'TIME_LIMIT_EXCEEDED').length,
          languageUsage: langUsage,
          dailyActivity,
        });
      }
      setLoading(false);
    }
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-arena-accent animate-spin" />
      </div>
    );
  }

  const acceptanceRate = stats.totalSubmissions > 0 ? Math.round((stats.accepted / stats.totalSubmissions) * 100) : 0;
  const maxDaily = Math.max(...stats.dailyActivity.map(d => d.count), 1);
  const maxLang = Math.max(...Object.values(stats.languageUsage), 1);

  const statusBreakdown = [
    { label: 'Accepted', count: stats.accepted, color: 'bg-emerald-500' },
    { label: 'Wrong Answer', count: stats.wrongAnswer, color: 'bg-rose-500' },
    { label: 'Compilation Error', count: stats.compilationError, color: 'bg-orange-500' },
    { label: 'Runtime Error', count: stats.runtimeError, color: 'bg-amber-500' },
    { label: 'Time Limit Exceeded', count: stats.tle, color: 'bg-yellow-500' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-arena-text">Analytics</h1>
        <p className="text-sm text-arena-subtle mt-1">Platform performance and insights</p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card p-5">
          <Activity className="w-5 h-5 text-sky-400 mb-2" />
          <p className="text-2xl font-bold text-arena-text">{stats.totalSubmissions}</p>
          <p className="text-sm text-arena-subtle">Total Submissions</p>
        </div>
        <div className="stat-card p-5">
          <TrendingUp className="w-5 h-5 text-emerald-400 mb-2" />
          <p className="text-2xl font-bold text-arena-text">{acceptanceRate}%</p>
          <p className="text-sm text-arena-subtle">Acceptance Rate</p>
        </div>
        <div className="stat-card p-5">
          <Award className="w-5 h-5 text-amber-400 mb-2" />
          <p className="text-2xl font-bold text-arena-text">{stats.accepted}</p>
          <p className="text-sm text-arena-subtle">Accepted Solutions</p>
        </div>
        <div className="stat-card p-5">
          <BarChart3 className="w-5 h-5 text-purple-400 mb-2" />
          <p className="text-2xl font-bold text-arena-text">{stats.dailyActivity.length}</p>
          <p className="text-sm text-arena-subtle">Active Days</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Submission activity chart */}
        <div className="glass-card p-5">
          <h3 className="text-arena-text font-semibold mb-4">Submission Activity</h3>
          {stats.dailyActivity.length === 0 ? (
            <p className="text-sm text-arena-subtle text-center py-8">No data yet</p>
          ) : (
            <div className="flex items-end justify-between gap-2 h-40">
              {stats.dailyActivity.map((day, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-arena-accent/60 hover:bg-arena-accent rounded-t transition-all duration-300"
                    style={{ height: `${(day.count / maxDaily) * 100}%`, minHeight: '4px' }}
                    title={`${day.count} submissions`}
                  />
                  <span className="text-xs text-arena-muted truncate w-full text-center">{day.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status breakdown */}
        <div className="glass-card p-5">
          <h3 className="text-arena-text font-semibold mb-4">Submission Status Breakdown</h3>
          <div className="space-y-3">
            {statusBreakdown.map((item, i) => {
              const pct = stats.totalSubmissions > 0 ? (item.count / stats.totalSubmissions) * 100 : 0;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-arena-subtle">{item.label}</span>
                    <span className="text-sm text-arena-text font-medium">{item.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-arena-bg overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Language usage */}
        <div className="glass-card p-5">
          <h3 className="text-arena-text font-semibold mb-4 flex items-center gap-2">
            <Code2 className="w-4 h-4 text-arena-accent" /> Language Usage
          </h3>
          <div className="space-y-3">
            {Object.entries(stats.languageUsage).map(([lang, count]) => {
              const pct = maxLang > 0 ? (count / maxLang) * 100 : 0;
              return (
                <div key={lang}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-arena-subtle">{lang.toUpperCase()}</span>
                    <span className="text-sm text-arena-text font-medium">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-arena-bg overflow-hidden">
                    <div className="h-full bg-arena-accent rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Summary */}
        <div className="glass-card p-5">
          <h3 className="text-arena-text font-semibold mb-4">Platform Summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-arena-subtle">Total Submissions</span>
              <span className="text-arena-text font-medium">{stats.totalSubmissions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-arena-subtle">Accepted</span>
              <span className="text-emerald-400 font-medium">{stats.accepted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-arena-subtle">Failed</span>
              <span className="text-rose-400 font-medium">{stats.totalSubmissions - stats.accepted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-arena-subtle">Acceptance Rate</span>
              <span className="text-arena-text font-medium">{acceptanceRate}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
