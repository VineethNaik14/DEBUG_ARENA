import { useEffect, useState } from 'react';
import { Trophy, Crown, Medal, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { LeaderboardEntry } from '@/types';

export function AdminLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    }
    void fetchLeaderboard();

    const channel = supabase
      .channel('admin-leaderboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solved_problems' }, () => fetchLeaderboard())
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, []);

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
        <h1 className="text-2xl font-bold text-arena-text">Leaderboard</h1>
        <p className="text-sm text-arena-subtle mt-1">Full student rankings</p>
      </div>

      {error ? (
        <div className="glass-card p-6 border border-rose-500/30 text-rose-400 text-sm">
          Could not load the leaderboard: {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Trophy className="w-10 h-10 text-arena-muted mx-auto mb-3" />
          <p className="text-arena-subtle">No rankings yet</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-arena-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Rank</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Student</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider hidden sm:table-cell">Student ID</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Solved</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Points</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.user_id} className="border-b border-arena-border last:border-0 hover:bg-arena-surface/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {entry.rank === 1 && <Crown className="w-4 h-4 text-amber-400" />}
                      {entry.rank === 2 && <Medal className="w-4 h-4 text-slate-300" />}
                      {entry.rank === 3 && <Medal className="w-4 h-4 text-amber-700" />}
                      <span className="font-bold text-arena-text">{entry.rank}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center text-xs font-semibold text-arena-accent">
                        {entry.full_name?.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-arena-text font-medium">{entry.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-sm text-arena-subtle font-mono">{entry.student_id || 'N/A'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-arena-text">{entry.problems_solved}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-amber-400">{entry.total_points}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
