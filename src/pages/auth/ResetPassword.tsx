import { useState, type FormEvent, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bug, Lock, AlertCircle, ArrowRight, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function ResetPassword() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validSession, setValidSession] = useState(false);

  useEffect(() => {
    // Check if we have a valid recovery session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setValidSession(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setValidSession(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSuccess(true);
  }

  return (
    <div className="min-h-screen bg-arena-bg flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-arena-accent/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-lg bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center">
            <Bug className="w-5 h-5 text-arena-accent" />
          </div>
          <span className="text-xl font-bold text-arena-text tracking-tight">DEBUG ARENA</span>
        </Link>

        <div className="glass-card p-8 animate-slide-up">
          {success ? (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-7 h-7 text-emerald-400" />
              </div>
              <h1 className="text-xl font-bold text-arena-text mb-2">Password Reset Successfully</h1>
              <p className="text-sm text-arena-subtle mb-6">
                Your password has been updated. You can now sign in with your new password.
              </p>
              <Link to="/login" className="btn-primary inline-flex items-center gap-2">
                Go to Login <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-arena-text mb-1">Reset Password</h1>
              <p className="text-sm text-arena-subtle mb-6">Enter your new password below</p>

              {!validSession && (
                <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400 animate-fade-in">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>If the reset link has expired, please request a new one from the forgot password page.</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-arena-error/10 border border-arena-error/30 text-sm text-arena-error animate-fade-in">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arena-muted" />
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="input-field pl-10"
                      placeholder="Min 6 characters"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arena-muted" />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="input-field pl-10"
                      placeholder="Re-enter new password"
                      required
                    />
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                  {loading ? 'Updating...' : 'Reset Password'}
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>

              <p className="text-sm text-arena-subtle text-center mt-6">
                <Link to="/forgot-password" className="text-arena-accent hover:underline font-medium">
                  Request new reset link
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
