import { useEffect, useState } from 'react';
import { Settings, Shield, Database, Code2, Users, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ExecutionHealth } from '@/types';

export function AdminSettings() {
  const [stats, setStats] = useState({ students: 0, problems: 0, submissions: 0, competitions: 0 });
  const [health, setHealth] = useState<ExecutionHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  async function checkExecutionService() {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evaluate-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'health' }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error || `Request failed (${response.status}). Is the evaluate-code function deployed?`);
      }
      setHealth(data as ExecutionHealth);
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setHealthLoading(false);
    }
  }

  useEffect(() => {
    async function fetchStats() {
      const [s, p, sub, c] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT'),
        supabase.from('problems').select('id', { count: 'exact', head: true }),
        supabase.from('submissions').select('id', { count: 'exact', head: true }),
        supabase.from('competitions').select('id', { count: 'exact', head: true }),
      ]);
      setStats({
        students: s.count || 0,
        problems: p.count || 0,
        submissions: sub.count || 0,
        competitions: c.count || 0,
      });
    }
    fetchStats();
  }, []);

  const settings = [
    { icon: Users, label: 'Total Students', value: stats.students, color: 'text-sky-400' },
    { icon: Code2, label: 'Total Problems', value: stats.problems, color: 'text-amber-400' },
    { icon: Database, label: 'Total Submissions', value: stats.submissions, color: 'text-emerald-400' },
    { icon: Shield, label: 'Competitions', value: stats.competitions, color: 'text-purple-400' },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-arena-text">Settings</h1>
        <p className="text-sm text-arena-subtle mt-1">Platform configuration and information</p>
      </div>

      {/* Platform stats */}
      <div className="glass-card p-6">
        <h3 className="text-arena-text font-semibold mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4 text-arena-accent" /> Platform Statistics
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {settings.map((item, i) => (
            <div key={i} className="p-4 rounded-lg bg-arena-bg/50 border border-arena-border">
              <item.icon className={`w-5 h-5 ${item.color} mb-2`} />
              <p className="text-xl font-bold text-arena-text">{item.value}</p>
              <p className="text-xs text-arena-muted">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Code execution service */}
      <div className="glass-card p-6">
        <h3 className="text-arena-text font-semibold mb-2 flex items-center gap-2">
          <Code2 className="w-4 h-4 text-arena-accent" /> Code Execution Service
        </h3>
        <p className="text-sm text-arena-subtle mb-4">
          Student code runs in a sandbox (Piston) configured through the EXECUTION_SERVICE_URL secret of the evaluate-code function.
        </p>
        <button onClick={checkExecutionService} disabled={healthLoading} className="btn-secondary flex items-center gap-2">
          {healthLoading && <Loader2 className="w-4 h-4 animate-spin" />} Check connection
        </button>
        {healthError && <p className="text-sm text-arena-error mt-3">{healthError}</p>}
        {health && (
          <div className="mt-3 space-y-2 text-sm">
            <p className={`flex items-center gap-2 ${health.ok ? 'text-emerald-400' : 'text-arena-error'}`}>
              {health.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} {health.detail}
            </p>
            {Object.entries(health.languages).map(([lang, version]) => (
              <p key={lang} className="text-arena-subtle font-mono text-xs">
                {lang}: {version ?? 'not installed'}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Security info */}
      <div className="glass-card p-6">
        <h3 className="text-arena-text font-semibold mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" /> Security Status
        </h3>
        <div className="space-y-2">
          {[
            'Row Level Security enabled on all tables',
            'Hidden test cases isolated from student access',
            'Server-controlled competition timer',
            'Role-based access control enforced',
            'Secure code execution via Edge Functions',
            'No service role key in frontend',
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-arena-subtle">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Admin setup info */}
      <div className="glass-card p-6">
        <h3 className="text-arena-text font-semibold mb-3">Admin Account Setup</h3>
        <div className="space-y-2 text-sm text-arena-subtle">
          <p>To create a new admin account:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Sign the user up normally (or create it in Supabase Auth)</li>
            <li>Promote its automatically-created profile to role = 'ADMIN' (SQL below)</li>
            <li>The user can now sign in via the admin login page</li>
          </ol>
          <pre className="mt-3 p-3 rounded-lg bg-arena-bg border border-arena-border text-xs text-arena-text font-mono overflow-x-auto">
{`-- 1. Sign the user up normally (a STUDENT profile is created automatically)
-- 2. In the Supabase SQL Editor, promote that user:
UPDATE public.profiles
SET role = 'ADMIN', is_active = true
WHERE email = 'admin@debugarena.com';`}
          </pre>
        </div>
      </div>
    </div>
  );
}
