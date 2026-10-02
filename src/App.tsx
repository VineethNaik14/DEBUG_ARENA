import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { LandingPage } from '@/pages/LandingPage';
import { StudentSignup } from '@/pages/auth/StudentSignup';
import { StudentLogin } from '@/pages/auth/StudentLogin';
import { AdminLogin } from '@/pages/auth/AdminLogin';
import { ForgotPassword } from '@/pages/auth/ForgotPassword';
import { ResetPassword } from '@/pages/auth/ResetPassword';
import { StudentLayout } from '@/layouts/StudentLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { StudentDashboard } from '@/pages/student/StudentDashboard';
import { ProblemList } from '@/pages/student/ProblemList';
import { ProblemWorkspace } from '@/pages/student/ProblemWorkspace';
import { Leaderboard } from '@/pages/student/Leaderboard';
import { SubmissionHistory } from '@/pages/student/SubmissionHistory';
import { NotificationsPage } from '@/pages/student/NotificationsPage';
import { StudentProfile } from '@/pages/student/StudentProfile';
import { AdminDashboard } from '@/pages/admin/AdminDashboard';
import { AdminStudents } from '@/pages/admin/AdminStudents';
import { AdminProblems } from '@/pages/admin/AdminProblems';
import { AdminSubmissions } from '@/pages/admin/AdminSubmissions';
import { AdminCompetition } from '@/pages/admin/AdminCompetition';
import { AdminAnalytics } from '@/pages/admin/AdminAnalytics';
import { AdminLeaderboard } from '@/pages/admin/AdminLeaderboard';
import { AdminSettings } from '@/pages/admin/AdminSettings';
import { LoadingScreen } from '@/components/LoadingScreen';

function ProtectedRoute({ children, requireRole }: { children: React.ReactNode; requireRole?: 'STUDENT' | 'ADMIN' }) {
  const { user, profile, loading, signOut } = useAuth();

  // Inactive accounts must never reach student/admin functionality. RLS and
  // the Edge Function also enforce this server-side (this is UX only, not
  // the security boundary), but signing the user out here prevents a
  // disabled student from continuing to browse a stale, already-loaded
  // session client-side.
  useEffect(() => {
    if (!loading && user && profile && !profile.is_active) {
      signOut();
    }
  }, [loading, user, profile, signOut]);

  if (loading) return <LoadingScreen />;
  if (!user || !profile) return <Navigate to="/login" replace />;
  if (!profile.is_active) return <Navigate to="/login?inactive=1" replace />;
  if (requireRole && profile.role !== requireRole) {
    return <Navigate to={profile.role === 'ADMIN' ? '/admin/dashboard' : '/student/dashboard'} replace />;
  }
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (user && profile) {
    return <Navigate to={profile.role === 'ADMIN' ? '/admin/dashboard' : '/student/dashboard'} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicOnlyRoute><LandingPage /></PublicOnlyRoute>} />
      <Route path="/login" element={<PublicOnlyRoute><StudentLogin /></PublicOnlyRoute>} />
      <Route path="/student/signup" element={<PublicOnlyRoute><StudentSignup /></PublicOnlyRoute>} />
      <Route path="/admin/login" element={<PublicOnlyRoute><AdminLogin /></PublicOnlyRoute>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/student" element={<ProtectedRoute requireRole="STUDENT"><StudentLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/student/dashboard" replace />} />
        <Route path="dashboard" element={<StudentDashboard />} />
        <Route path="problems" element={<ProblemList />} />
        <Route path="problems/:problemId" element={<ProblemWorkspace />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="submissions" element={<SubmissionHistory />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<StudentProfile />} />
      </Route>

      <Route path="/admin" element={<ProtectedRoute requireRole="ADMIN"><AdminLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="students" element={<AdminStudents />} />
        <Route path="problems" element={<AdminProblems />} />
        <Route path="submissions" element={<AdminSubmissions />} />
        <Route path="leaderboard" element={<AdminLeaderboard />} />
        <Route path="competition" element={<AdminCompetition />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
