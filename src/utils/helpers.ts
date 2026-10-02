import type { Competition, CompetitionStatus, ProblemDifficulty, SubmissionStatus } from '@/types';

export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return '00 : 00 : 00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')} : ${String(minutes).padStart(2, '0')} : ${String(seconds).padStart(2, '0')}`;
}

export interface CompetitionState {
  status: CompetitionStatus;
  /** ms until the end (LIVE) or until the scheduled start (UPCOMING); 0 otherwise */
  timeRemaining: number;
  /** UPCOMING, scheduled start has passed, but an admin has not pressed Start yet */
  awaitingStart: boolean;
}

/**
 * Effective competition state. Mirrors the server rule in
 * reserve_submission(): submissions are accepted only while
 * status = 'LIVE' AND start_time <= now <= end_time. The UI must never
 * claim LIVE when the server would reject a submission.
 */
export function getCompetitionState(
  competition: Pick<Competition, 'status' | 'start_time' | 'end_time'> | null,
  now: number = Date.now(),
): CompetitionState {
  if (!competition) return { status: 'ENDED', timeRemaining: 0, awaitingStart: false };

  const start = competition.start_time ? new Date(competition.start_time).getTime() : null;
  const end = competition.end_time ? new Date(competition.end_time).getTime() : null;

  if (competition.status === 'ENDED' || (end !== null && now > end)) {
    return { status: 'ENDED', timeRemaining: 0, awaitingStart: false };
  }
  if (competition.status === 'LIVE' && start !== null && end !== null && now >= start) {
    return { status: 'LIVE', timeRemaining: end - now, awaitingStart: false };
  }
  return {
    status: 'UPCOMING',
    timeRemaining: start !== null ? Math.max(0, start - now) : 0,
    awaitingStart: start !== null && now >= start,
  };
}

export function difficultyColor(difficulty: ProblemDifficulty): string {
  switch (difficulty) {
    case 'EASY': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    case 'MEDIUM': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 'HARD': return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  }
}

export function statusColor(status: SubmissionStatus): string {
  switch (status) {
    case 'ACCEPTED': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    case 'WRONG_ANSWER': return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    case 'COMPILATION_ERROR': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    case 'RUNTIME_ERROR': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    case 'TIME_LIMIT_EXCEEDED': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 'MEMORY_LIMIT_EXCEEDED': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 'PENDING': return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
    default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  }
}

export function competitionStatusColor(status: CompetitionStatus): string {
  switch (status) {
    case 'LIVE': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    case 'UPCOMING': return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
    case 'ENDED': return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  }
}

export function formatDate(date: string | null): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(date: string): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

export function getLanguageLabel(lang: string): string {
  switch (lang) {
    case 'python': return 'Python';
    case 'cpp': return 'C++';
    case 'java': return 'Java';
    default: return lang;
  }
}

export function getMonacoLanguage(lang: string): string {
  switch (lang) {
    case 'python': return 'python';
    case 'cpp': return 'cpp';
    case 'java': return 'java';
    default: return 'plaintext';
  }
}

export function roundColor(round: number): string {
  switch (round) {
    case 1: return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
    case 2: return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    case 3: return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  }
}

export function roundLabel(round: number): string {
  switch (round) {
    case 1: return 'Round 1 — Warm-up';
    case 2: return 'Round 2 — Intermediate';
    case 3: return 'Round 3 — Advanced';
    default: return `Round ${round}`;
  }
}
