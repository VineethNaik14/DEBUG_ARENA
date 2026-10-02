import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Bug, LayoutDashboard, Code2, Trophy, FileCode2, Bell, User, LogOut, Menu, X, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentCompetition } from '@/hooks/useCurrentCompetition';
import { formatTimeRemaining, competitionStatusColor } from '@/utils/helpers';

export function StudentLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { competition, status, timeRemaining, awaitingStart } = useCurrentCompetition();

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  const navItems = [
    { to: '/student/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/student/problems', icon: Code2, label: 'Problems' },
    { to: '/student/leaderboard', icon: Trophy, label: 'Leaderboard' },
    { to: '/student/submissions', icon: FileCode2, label: 'My Submissions' },
    { to: '/student/notifications', icon: Bell, label: 'Notifications' },
    { to: '/student/profile', icon: User, label: 'Profile' },
  ];

  return (
    <div className="min-h-screen bg-arena-bg flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:sticky top-0 left-0 h-screen w-64 bg-arena-surface border-r border-arena-border z-40
        flex flex-col transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex items-center justify-between px-5 py-5 border-b border-arena-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center">
              <Bug className="w-4 h-4 text-arena-accent" />
            </div>
            <span className="text-sm font-bold text-arena-text tracking-tight">DEBUG ARENA</span>
          </div>
          <button className="lg:hidden text-arena-muted" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon className="w-4 h-4" />
              <span className="text-sm">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-arena-border">
          <div className="flex items-center gap-3 px-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center text-sm font-semibold text-arena-accent">
              {profile?.full_name?.charAt(0).toUpperCase() || 'S'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-arena-text truncate">{profile?.full_name}</p>
              <p className="text-xs text-arena-muted truncate">{profile?.student_id || 'Student'}</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="nav-link w-full text-arena-error hover:text-arena-error">
            <LogOut className="w-4 h-4" />
            <span className="text-sm">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-arena-bg/80 backdrop-blur-md border-b border-arena-border px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <button className="lg:hidden text-arena-muted" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>

            {/* Competition status banner */}
            {competition && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${competitionStatusColor(status)}`}>
                {status === 'LIVE' && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                {status === 'UPCOMING' && <Clock className="w-3.5 h-3.5" />}
                {status === 'ENDED' && <span className="w-2 h-2 rounded-full bg-slate-400" />}
                <span className="font-medium">
                  {status === 'LIVE' && 'LIVE'}
                  {status === 'UPCOMING' && (awaitingStart ? 'Waiting for admin to start' : 'Starts in')}
                  {status === 'ENDED' && 'ENDED'}
                </span>
                {(status === 'LIVE' || (status === 'UPCOMING' && !awaitingStart)) && (
                  <span className="font-mono text-xs">{formatTimeRemaining(timeRemaining)}</span>
                )}
              </div>
            )}

            <div className="hidden sm:flex items-center gap-2 text-sm text-arena-subtle">
              <span className="font-medium text-arena-text">{profile?.total_points || 0}</span>
              <span>pts</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
