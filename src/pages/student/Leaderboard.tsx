import { useEffect, useState } from 'react';
import { Trophy, Medal, Crown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { LeaderboardEntry } from '@/types';

export function Leaderboard() {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = profile?.id;

  useEffect(() => {
    async function fetchLeaderboard() {
      const { data, error: rpcError } = await supabase.rpc('get_leaderboard');
      if (rpcError) {
        setError(rpcError.message);
      } else {
        setError(null);
        setEntries((data ?? []) as LeaderboardEntry[]);
      }
      setLoading(false);

      if (userId) {
        const { data: rank } = await supabase.rpc('get_student_rank', { p_user_id: userId });
        setMyRank(rank && rank > 0 ? rank : null);
      }
    }
    void fetchLeaderboard();

    // Students cannot receive other users' realtime events (RLS), so poll as well.
    const poll = window.setInterval(() => void fetchLeaderboard(), 15000);
    const channel = supabase
      .channel('leaderboard-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solved_problems' }, () => void fetchLeaderboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void fetchLeaderboard())
      .subscribe();

    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-arena-subtle text-sm">Loading leaderboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-arena-text">Leaderboard</h1>
          <p className="text-sm text-arena-subtle mt-1">See how you rank against other students</p>
        </div>
        {myRank && (
          <div className="stat-card px-5 py-3 flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-400" />
            <div>
              <p className="text-xs text-arena-muted">Your Rank</p>
              <p className="text-lg font-bold text-arena-text">#{myRank}</p>
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div className="glass-card p-6 border border-rose-500/30 text-rose-400 text-sm">
          Could not load the leaderboard: {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Trophy className="w-10 h-10 text-arena-muted mx-auto mb-3" />
          <p className="text-arena-subtle">No rankings yet. Be the first to solve a problem!</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-arena-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Rank</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Student</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider hidden sm:table-cell">Solved</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Points</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isMe = profile?.id === entry.user_id;
                return (
                  <tr
                    key={entry.user_id}
                    className={`border-b border-arena-border last:border-0 transition-colors ${
                      isMe ? 'bg-arena-accent/5' : 'hover:bg-arena-surface/50'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {entry.rank === 1 && <Crown className="w-4 h-4 text-amber-400" />}
                        {entry.rank === 2 && <Medal className="w-4 h-4 text-slate-300" />}
                        {entry.rank === 3 && <Medal className="w-4 h-4 text-amber-700" />}
                        <span className={`font-bold ${entry.rank <= 3 ? 'text-arena-text' : 'text-arena-subtle'}`}>
                          {entry.rank}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center text-sm font-semibold text-arena-accent shrink-0">
                          {entry.full_name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-arena-text truncate">
                            {entry.full_name}
                            {isMe && <span className="text-arena-accent ml-1.5 text-xs">(You)</span>}
                          </p>
                          <p className="text-xs text-arena-muted truncate">{entry.student_id || 'Student'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      <span className="text-sm text-arena-text font-medium">{entry.problems_solved}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-amber-400">{entry.total_points}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
