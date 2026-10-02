import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Trophy,
  CheckCircle2,
  Target,
  TrendingUp,
  Clock,
  Zap,
  ArrowRight,
  Award,
  FileCode2,
  Layers,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useCurrentCompetition } from '@/hooks/useCurrentCompetition';
import { formatTimeRemaining, competitionStatusColor } from '@/utils/helpers';
import type { Submission } from '@/types';

export function StudentDashboard() {
  const { profile } = useAuth();

  const [rank, setRank] = useState<number | null>(null);
  const [recentSubmissions, setRecentSubmissions] = useState<Submission[]>([]);
  const { competition, status, timeRemaining, awaitingStart } =
    useCurrentCompetition();
  const [roundCounts, setRoundCounts] = useState<Record<number, number>>({
    1: 0,
    2: 0,
    3: 0,
  });

  const userId = profile?.id;

  useEffect(() => {
    if (!userId) return;

    const currentUserId = userId;

    async function fetchData() {
      const { data: rankData } = await supabase.rpc('get_student_rank', {
        p_user_id: currentUserId,
      });

      setRank(rankData ?? 0);

      const { data: subs } = await supabase
        .from('submissions')
        .select('*')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentSubmissions((subs as Submission[]) || []);

      const { data: problemsData } = await supabase
        .from('student_problems')
        .select('round_number');

      const counts: Record<number, number> = {
        1: 0,
        2: 0,
        3: 0,
      };

      (problemsData || []).forEach((p) => {
        counts[p.round_number] = (counts[p.round_number] || 0) + 1;
      });

      setRoundCounts(counts);
    }

    void fetchData();

    const channel = supabase
      .channel('student-dashboard-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'submissions',
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          void fetchData();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const accuracy =
    profile && profile.problems_attempted > 0
      ? Math.round(
          (profile.problems_solved / profile.problems_attempted) * 100
        )
      : 0;

  const stats = [
    {
      label: 'Total Points',
      value: profile?.total_points || 0,
      icon: Trophy,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
    },
    {
      label: 'Problems Solved',
      value: profile?.problems_solved || 0,
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
    },
    {
      label: 'Problems Attempted',
      value: profile?.problems_attempted || 0,
      icon: Target,
      color: 'text-sky-400',
      bg: 'bg-sky-500/10',
      border: 'border-sky-500/30',
    },
    {
      label: 'Current Rank',
      value: rank ? `#${rank}` : 'N/A',
      icon: Award,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/30',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-arena-text">
          Welcome back, {profile?.full_name?.split(' ')[0] || 'Student'}
        </h1>

        <p className="text-sm text-arena-subtle mt-1">
          {profile?.student_id} · {accuracy}% accuracy
        </p>
      </div>

      {/* Competition banner */}
      {competition && (
        <div className="glass-card p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium mb-2 ${competitionStatusColor(
                  status
                )}`}
              >
                {status === 'LIVE' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}

                {status === 'UPCOMING' && (
                  <Clock className="w-3 h-3" />
                )}

                {status === 'ENDED' && (
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                )}

                {status === 'LIVE'
                  ? 'COMPETITION LIVE'
                  : status === 'UPCOMING'
                    ? awaitingStart
                      ? 'WAITING FOR ADMIN TO START'
                      : 'COMPETITION STARTS IN'
                    : 'COMPETITION ENDED'}
              </div>

              <h2 className="text-lg font-bold text-arena-text">
                {competition.name}
              </h2>

              <p className="text-sm text-arena-subtle mt-0.5">
                {competition.description || 'Debug and compete'}
              </p>
            </div>

            {(status === 'LIVE' ||
              (status === 'UPCOMING' && !awaitingStart)) && (
              <div className="text-right">
                <p className="text-xs text-arena-muted uppercase tracking-wider mb-1">
                  {status === 'LIVE' ? 'Time Remaining' : 'Starts In'}
                </p>

                <p className="text-3xl font-mono font-bold text-arena-text tabular-nums">
                  {formatTimeRemaining(timeRemaining)}
                </p>
              </div>
            )}
          </div>

          {/* Round summary */}
          {(roundCounts[1] > 0 ||
            roundCounts[2] > 0 ||
            roundCounts[3] > 0) && (
            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-arena-border">
              {[1, 2, 3].map((round) => (
                <div key={round} className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-arena-accent shrink-0" />

                  <div>
                    <p className="text-xs text-arena-muted">
                      Round {round}
                    </p>

                    <p className="text-sm font-medium text-arena-text">
                      {roundCounts[round] || 0} problems
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div
            key={i}
            className="stat-card p-5 animate-slide-up"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div
              className={`w-10 h-10 rounded-lg ${stat.bg} border ${stat.border} flex items-center justify-center mb-3`}
            >
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>

            <p className="text-2xl font-bold text-arena-text">
              {stat.value}
            </p>

            <p className="text-sm text-arena-subtle mt-0.5">
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {/* Recent submissions + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-arena-text font-semibold">
              Recent Submissions
            </h3>

            <Link
              to="/student/submissions"
              className="text-sm text-arena-accent hover:underline flex items-center gap-1"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentSubmissions.length === 0 ? (
            <div className="text-center py-8">
              <FileCode2 className="w-8 h-8 text-arena-muted mx-auto mb-2" />

              <p className="text-sm text-arena-subtle">
                No submissions yet
              </p>

              <Link
                to="/student/problems"
                className="text-sm text-arena-accent hover:underline mt-2 inline-block"
              >
                Start solving problems
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentSubmissions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-arena-bg/50 border border-arena-border"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-arena-text truncate">
                      {sub.language.toUpperCase()} submission
                    </p>

                    <p className="text-xs text-arena-muted">
                      {new Date(sub.created_at).toLocaleString()}
                    </p>
                  </div>

                  <span
                    className={`badge ${
                      sub.status === 'ACCEPTED'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                    }`}
                  >
                    {sub.status === 'ACCEPTED' ? 'Accepted' : 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <h3 className="text-arena-text font-semibold mb-4">
            Quick Actions
          </h3>

          <div className="space-y-2">
            <Link
              to="/student/problems"
              className="flex items-center gap-3 p-3 rounded-lg bg-arena-bg/50 border border-arena-border hover:border-arena-accent transition-colors"
            >
              <Zap className="w-4 h-4 text-arena-accent" />

              <span className="text-sm text-arena-text font-medium">
                Start Debugging
              </span>

              <ArrowRight className="w-4 h-4 text-arena-muted ml-auto" />
            </Link>

            <Link
              to="/student/leaderboard"
              className="flex items-center gap-3 p-3 rounded-lg bg-arena-bg/50 border border-arena-border hover:border-arena-accent transition-colors"
            >
              <TrendingUp className="w-4 h-4 text-amber-400" />

              <span className="text-sm text-arena-text font-medium">
                View Leaderboard
              </span>

              <ArrowRight className="w-4 h-4 text-arena-muted ml-auto" />
            </Link>

            <Link
              to="/student/submissions"
              className="flex items-center gap-3 p-3 rounded-lg bg-arena-bg/50 border border-arena-border hover:border-arena-accent transition-colors"
            >
              <Clock className="w-4 h-4 text-sky-400" />

              <span className="text-sm text-arena-text font-medium">
                Submission History
              </span>

              <ArrowRight className="w-4 h-4 text-arena-muted ml-auto" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}