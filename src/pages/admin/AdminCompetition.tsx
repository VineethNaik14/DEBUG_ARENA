import { useEffect, useState, type FormEvent } from 'react';
import { Clock, Play, Square, AlertCircle, Loader2, CheckCircle2, Layers, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCurrentCompetition } from '@/hooks/useCurrentCompetition';
import { competitionStatusColor, formatTimeRemaining, formatDate } from '@/utils/helpers';
import type { Competition } from '@/types';

const pad = (n: number) => String(n).padStart(2, '0');
// Local-time pieces for <input type="date|time">. (toISOString() would give the UTC date.)
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

interface FormState {
  name: string;
  description: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  duration: number;
  maximum_attempts: number;
}

function blankForm(): FormState {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    name: '',
    description: '',
    start_date: toDateInput(start),
    start_time: toTimeInput(start),
    end_date: toDateInput(end),
    end_time: toTimeInput(end),
    duration: 120,
    maximum_attempts: 3,
  };
}

function formFromCompetition(comp: Competition): FormState {
  const start = comp.start_time ? new Date(comp.start_time) : null;
  const end = comp.end_time ? new Date(comp.end_time) : null;
  const blank = blankForm();
  return {
    name: comp.name,
    description: comp.description || '',
    start_date: start ? toDateInput(start) : blank.start_date,
    start_time: start ? toTimeInput(start) : blank.start_time,
    end_date: end ? toDateInput(end) : blank.end_date,
    end_time: end ? toTimeInput(end) : blank.end_time,
    duration: comp.duration || 120,
    maximum_attempts: comp.maximum_attempts || 3,
  };
}

export function AdminCompetition() {
  const { competition, status, timeRemaining, awaitingStart, loading, reload } = useCurrentCompetition();
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [roundCounts, setRoundCounts] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0 });
  const [form, setForm] = useState<FormState>(blankForm);
  const [creatingNew, setCreatingNew] = useState(false);
  const [formLoadedFor, setFormLoadedFor] = useState<string | null>(null);

  // An ended competition cannot be edited: the form then creates a new one.
  const editing = competition !== null && status !== 'ENDED' && !creatingNew;

  // Load the form from the current competition once per competition (don't clobber edits on every poll).
  useEffect(() => {
    if (!competition || creatingNew) return;
    if (formLoadedFor === competition.id) return;
    if (status === 'ENDED') {
      setForm(blankForm());
    } else {
      setForm(formFromCompetition(competition));
    }
    setFormLoadedFor(competition.id);
  }, [competition, status, creatingNew, formLoadedFor]);

  useEffect(() => {
    async function fetchRoundCounts() {
      const { data } = await supabase.from('problems').select('round_number');
      const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
      (data || []).forEach((p) => {
        counts[p.round_number] = (counts[p.round_number] || 0) + 1;
      });
      setRoundCounts(counts);
    }
    void fetchRoundCounts();

    const channel = supabase
      .channel('admin-comp-problems')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'problems' }, () => void fetchRoundCounts())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  function startNewCompetition() {
    setCreatingNew(true);
    setForm(blankForm());
    setMessage(null);
  }

  function cancelNewCompetition() {
    setCreatingNew(false);
    setFormLoadedFor(null);
    setMessage(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const start = new Date(`${form.start_date}T${form.start_time}`);
      const end = new Date(`${form.end_date}T${form.end_time}`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error('Please enter a valid start and end date/time.');
      }
      if (end <= start) throw new Error('End time must be after the start time.');

      const { error } = await supabase.rpc('admin_save_competition', {
        p_id: editing && competition ? competition.id : undefined,
        p_name: form.name,
        p_description: form.description,
        p_start_time: start.toISOString(),
        p_end_time: end.toISOString(),
        p_duration: form.duration,
        p_maximum_attempts: form.maximum_attempts,
      });
      if (error) throw new Error(error.message);

      const created = !editing;
      setCreatingNew(false);
      setFormLoadedFor(null);
      await reload();
      setMessage({ type: 'success', text: created ? 'Competition created. Press Start when you are ready.' : 'Competition saved successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save competition' });
    } finally {
      setSaving(false);
    }
  }

  async function runAction(rpc: 'start_competition' | 'end_competition', success: string) {
    if (!competition) return;
    setActionLoading(true);
    const { error } = await supabase.rpc(rpc, { p_competition_id: competition.id });
    setActionLoading(false);
    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: success });
      setFormLoadedFor(null);
      await reload();
    }
  }

  const startCompetition = () => runAction('start_competition', 'Competition started! Students will see LIVE status.');
  const endCompetition = () => runAction('end_competition', 'Competition ended.');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-arena-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-arena-text">Competition Control</h1>
        <p className="text-sm text-arena-subtle mt-1">Configure and manage the competition</p>
      </div>

      {/* Current status */}
      {competition && (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-arena-muted mb-1">Current Status</p>
              <span className={`badge ${competitionStatusColor(status)}`}>
                {status === 'LIVE' && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                {status === 'LIVE' ? 'COMPETITION LIVE' : status === 'UPCOMING' ? (awaitingStart ? 'READY — PRESS START' : 'UPCOMING') : 'ENDED'}
              </span>
            </div>
            {(status === 'LIVE' || (status === 'UPCOMING' && !awaitingStart)) && (
              <div className="text-right">
                <p className="text-xs text-arena-muted uppercase tracking-wider mb-1">{status === 'LIVE' ? 'Time Remaining' : 'Starts In'}</p>
                <p className="text-2xl font-mono font-bold text-arena-text tabular-nums">{formatTimeRemaining(timeRemaining)}</p>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={startCompetition}
              disabled={actionLoading || status === 'LIVE' || status === 'ENDED'}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              <Play className="w-4 h-4" /> Start Competition
            </button>
            <button
              onClick={endCompetition}
              disabled={actionLoading || status !== 'LIVE'}
              className="btn-danger flex items-center gap-2 disabled:opacity-50"
            >
              <Square className="w-4 h-4" /> End Competition
            </button>
            <button
              onClick={startNewCompetition}
              disabled={actionLoading || status === 'LIVE' || creatingNew}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50 ml-auto"
              title={status === 'LIVE' ? 'End the live competition first' : 'Create a new competition'}
            >
              <Plus className="w-4 h-4" /> New Competition
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm animate-fade-in ${
          message.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            : 'bg-arena-error/10 border border-arena-error/30 text-arena-error'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Configuration form */}
      <div className="glass-card p-6">
        <h3 className="text-arena-text font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-arena-accent" /> {editing ? 'Competition Configuration' : 'Create New Competition'}
        </h3>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm text-arena-subtle mb-1.5">Competition Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="Debug Arena Championship" required />
          </div>

          <div>
            <label className="block text-sm text-arena-subtle mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input-field min-h-[80px] resize-y" placeholder="Competition description..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-arena-subtle mb-1.5">Start Date</label>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm text-arena-subtle mb-1.5">Start Time</label>
              <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm text-arena-subtle mb-1.5">End Date</label>
              <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm text-arena-subtle mb-1.5">End Time</label>
              <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="input-field" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-arena-subtle mb-1.5">Duration (minutes)</label>
              <input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: parseInt(e.target.value) || 0 })} className="input-field" />
            </div>
            <div>
              <label className="block text-sm text-arena-subtle mb-1.5">Max Attempts per Problem</label>
              <input type="number" value={form.maximum_attempts} onChange={(e) => setForm({ ...form, maximum_attempts: parseInt(e.target.value) || 0 })} className="input-field" />
            </div>
          </div>

          <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving...' : editing ? 'Save Competition' : 'Create Competition'}
          </button>
          {creatingNew && competition && (
            <button type="button" onClick={cancelNewCompetition} className="btn-secondary w-full">
              Cancel
            </button>
          )}
        </form>
      </div>

      {competition && (
        <div className="glass-card p-5">
          <h4 className="text-sm font-semibold text-arena-text mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-arena-accent" /> Round Overview
          </h4>
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(round => (
              <div key={round} className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border text-center">
                <p className="text-xs text-arena-muted mb-1">Round {round}</p>
                <p className="text-xl font-bold text-arena-text">{roundCounts[round] || 0}</p>
                <p className="text-xs text-arena-muted">problems</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {competition && (
        <div className="glass-card p-5">
          <h4 className="text-sm font-semibold text-arena-text mb-2">Competition Details</h4>
          <div className="space-y-1 text-sm text-arena-subtle">
            <p>Start: {formatDate(competition.start_time)}</p>
            <p>End: {formatDate(competition.end_time)}</p>
            <p>Duration: {competition.duration} minutes</p>
            <p>Max attempts: {competition.maximum_attempts} per problem</p>
          </div>
        </div>
      )}
    </div>
  );
}
