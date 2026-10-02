import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Bug, LayoutDashboard, Users, Code2, FileCode2, Trophy, Clock, BarChart3, Settings, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export function AdminLayout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  const navItems = [
    { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/admin/students', icon: Users, label: 'Students' },
    { to: '/admin/problems', icon: Code2, label: 'Problems' },
    { to: '/admin/submissions', icon: FileCode2, label: 'Submissions' },
    { to: '/admin/leaderboard', icon: Trophy, label: 'Leaderboard' },
    { to: '/admin/competition', icon: Clock, label: 'Competition' },
    { to: '/admin/analytics', icon: BarChart3, label: 'Analytics' },
    { to: '/admin/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-arena-bg flex">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`
        fixed lg:sticky top-0 left-0 h-screen w-64 bg-arena-surface border-r border-arena-border z-40
        flex flex-col transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex items-center justify-between px-5 py-5 border-b border-arena-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Bug className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <span className="text-sm font-bold text-arena-text tracking-tight block leading-tight">DEBUG ARENA</span>
              <span className="text-xs text-amber-400 font-medium">Admin Panel</span>
            </div>
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
            <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-sm font-semibold text-amber-400">
              {profile?.full_name?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-arena-text truncate">{profile?.full_name}</p>
              <p className="text-xs text-arena-muted truncate">Administrator</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="nav-link w-full text-arena-error hover:text-arena-error">
            <LogOut className="w-4 h-4" />
            <span className="text-sm">Logout</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-arena-bg/80 backdrop-blur-md border-b border-arena-border px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between">
            <button className="lg:hidden text-arena-muted" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-arena-subtle ml-auto">
              <span className="badge border-amber-500/30 bg-amber-500/10 text-amber-400">
                Admin Mode
              </span>
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
