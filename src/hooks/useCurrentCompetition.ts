import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getCompetitionState, type CompetitionState } from '@/utils/helpers';
import type { Competition } from '@/types';

interface UseCurrentCompetition extends CompetitionState {
  /** The most recently created competition — the one the server enforces. */
  competition: Competition | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Single source of truth for "the current competition" in the UI.
 * Matches the server (reserve_submission uses the latest competition) and
 * derives LIVE/ENDED with the same rule via getCompetitionState().
 */
export function useCurrentCompetition(): UseCurrentCompetition {
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<CompetitionState>(getCompetitionState(null));

  const reload = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('competitions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setError(null);
      setCompetition((data as Competition | null) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    const channel = supabase
      .channel('current-competition')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competitions' }, () => {
        void reload();
      })
      .subscribe();
    const poll = window.setInterval(() => void reload(), 30000);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [reload]);

  useEffect(() => {
    setState(getCompetitionState(competition));
    const tick = window.setInterval(() => setState(getCompetitionState(competition)), 1000);
    return () => window.clearInterval(tick);
  }, [competition]);

  return { competition, loading, error, reload, ...state };
}
