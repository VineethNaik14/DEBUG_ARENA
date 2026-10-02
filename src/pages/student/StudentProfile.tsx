import { useState, type FormEvent } from 'react';
import { User, Mail, Hash, Trophy, CheckCircle2, Target, Award, Save, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export function StudentProfile() {
  const { profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const accuracy = profile && profile.problems_attempted > 0
    ? Math.round((profile.problems_solved / profile.problems_attempted) * 100)
    : 0;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', profile.id);

    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: 'Profile updated successfully' });
      refreshProfile();
    }
  }

  if (!profile) return null;

  const stats = [
    { label: 'Total Points', value: profile.total_points, icon: Trophy, color: 'text-amber-400' },
    { label: 'Problems Solved', value: profile.problems_solved, icon: CheckCircle2, color: 'text-emerald-400' },
    { label: 'Problems Attempted', value: profile.problems_attempted, icon: Target, color: 'text-sky-400' },
    { label: 'Accuracy', value: `${accuracy}%`, icon: Award, color: 'text-purple-400' },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-arena-text">Profile</h1>
        <p className="text-sm text-arena-subtle mt-1">Manage your account information</p>
      </div>

      {/* Profile card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center text-2xl font-bold text-arena-accent">
            {profile.full_name?.charAt(0).toUpperCase() || 'S'}
          </div>
          <div>
            <h2 className="text-lg font-bold text-arena-text">{profile.full_name}</h2>
            <p className="text-sm text-arena-subtle">{profile.email}</p>
            <span className="badge border-arena-accent/30 bg-arena-accent/10 text-arena-accent mt-1">
              {profile.role}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((stat, i) => (
            <div key={i} className="p-4 rounded-lg bg-arena-bg/50 border border-arena-border">
              <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
              <p className="text-xl font-bold text-arena-text">{stat.value}</p>
              <p className="text-xs text-arena-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Edit form */}
      <div className="glass-card p-6">
        <h3 className="text-arena-text font-semibold mb-4">Edit Profile</h3>

        {message && (
          <div className={`flex items-start gap-2 p-3 mb-4 rounded-lg text-sm animate-fade-in ${
            message.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-arena-error/10 border border-arena-error/30 text-arena-error'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm text-arena-subtle mb-1.5">Full Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arena-muted" />
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-field pl-10"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-arena-subtle mb-1.5">Email (read-only)</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arena-muted" />
              <input
                type="email"
                value={profile.email}
                disabled
                className="input-field pl-10 opacity-60 cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-arena-subtle mb-1.5">Student ID (read-only)</label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arena-muted" />
              <input
                type="text"
                value={profile.student_id || ''}
                disabled
                className="input-field pl-10 opacity-60 cursor-not-allowed"
              />
            </div>
          </div>

          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}
