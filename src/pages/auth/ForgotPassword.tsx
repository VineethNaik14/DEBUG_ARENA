import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bug, Mail, AlertCircle, ArrowRight, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

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
              <h1 className="text-xl font-bold text-arena-text mb-2">Check Your Email</h1>
              <p className="text-sm text-arena-subtle mb-6">
                We've sent a password reset link to <span className="text-arena-text font-medium">{email}</span>.
                Click the link in the email to reset your password.
              </p>
              <Link to="/login" className="btn-primary inline-flex items-center gap-2">
                Go to Login <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-arena-text mb-1">Forgot Password</h1>
              <p className="text-sm text-arena-subtle mb-6">Enter your email and we'll send you a reset link</p>

              {error && (
                <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-arena-error/10 border border-arena-error/30 text-sm text-arena-error animate-fade-in">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-arena-subtle mb-1.5">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arena-muted" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input-field pl-10"
                      placeholder="john@college.edu"
                      required
                    />
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                  {loading ? 'Sending...' : 'Send Reset Link'}
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>

              <p className="text-sm text-arena-subtle text-center mt-6">
                Remember your password?{' '}
                <Link to="/login" className="text-arena-accent hover:underline font-medium">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
