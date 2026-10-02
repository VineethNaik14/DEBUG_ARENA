import { Link } from 'react-router-dom';
import { Bug, Code2, Trophy, Zap, Shield, Clock, ArrowRight, Terminal } from 'lucide-react';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-arena-bg relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-arena-accent/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 lg:px-12 py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center">
            <Bug className="w-5 h-5 text-arena-accent" />
          </div>
          <span className="text-lg font-bold text-arena-text tracking-tight">DEBUG ARENA</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/admin/login" className="text-arena-subtle hover:text-arena-text text-sm font-medium transition-colors">
            Admin
          </Link>
          <Link to="/login" className="btn-primary text-sm">
            Sign In
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 lg:px-12 pt-16 lg:pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-arena-accent/10 border border-arena-accent/30 mb-8 animate-fade-in">
          <Zap className="w-3.5 h-3.5 text-arena-accent" />
          <span className="text-xs font-medium text-arena-accent">Competitive Debugging Platform</span>
        </div>

        <h1 className="text-5xl lg:text-7xl font-bold text-arena-text tracking-tight leading-[1.1] mb-6 animate-slide-up">
          Find the Bug.
          <br />
          <span className="bg-gradient-to-r from-arena-accent to-emerald-400 bg-clip-text text-transparent">
            Fix the Code.
          </span>
          <br />
          Beat the Clock.
        </h1>

        <p className="text-lg text-arena-subtle max-w-2xl mx-auto mb-10 leading-relaxed animate-slide-up">
          A real-time debugging competition platform for college students. Solve broken code,
          climb the leaderboard, and prove your debugging skills against the clock.
        </p>

        <div className="flex items-center justify-center gap-4 animate-slide-up">
          <Link to="/student/signup" className="btn-primary flex items-center gap-2">
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/login" className="btn-secondary">
            Sign In
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 lg:px-12 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: Code2, title: 'Monaco Editor', desc: 'Full-featured code editor with syntax highlighting for Python, C++, and Java.' },
            { icon: Trophy, title: 'Live Leaderboard', desc: 'Real-time rankings that update instantly as students solve problems.' },
            { icon: Clock, title: 'Server-Controlled Timer', desc: 'Competition timing enforced server-side. No clock manipulation possible.' },
            { icon: Shield, title: 'Secure Execution', desc: 'Code evaluated in isolated sandboxed environments with strict resource limits.' },
            { icon: Terminal, title: 'Hidden Test Cases', desc: 'Secret test cases validate solutions. Students never see them until evaluation.' },
            { icon: Zap, title: 'Instant Feedback', desc: 'Get immediate results on submissions with detailed error reporting.' },
          ].map((feature, i) => (
            <div key={i} className="glass-card p-6 hover:border-arena-accent/40 transition-all duration-200 animate-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="w-10 h-10 rounded-lg bg-arena-accent/10 border border-arena-accent/20 flex items-center justify-center mb-4">
                <feature.icon className="w-5 h-5 text-arena-accent" />
              </div>
              <h3 className="text-arena-text font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-arena-subtle leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-arena-border py-6 px-6 lg:px-12">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-arena-accent" />
            <span className="text-sm text-arena-subtle">DEBUG ARENA</span>
          </div>
          <p className="text-sm text-arena-muted">Find the Bug. Fix the Code. Beat the Clock.</p>
        </div>
      </footer>
    </div>
  );
}
