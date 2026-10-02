import { useEffect, useState } from 'react';
import { Search, Users, Eye, UserCog, X, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Profile, Submission } from '@/types';

export function AdminStudents() {
  const [students, setStudents] = useState<Profile[]>([]);
  const [filtered, setFiltered] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<Profile | null>(null);
  const [studentSubs, setStudentSubs] = useState<Submission[]>([]);
  const [studentSolved, setStudentSolved] = useState<number>(0);

  useEffect(() => {
    async function fetchStudents() {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'STUDENT')
        .order('total_points', { ascending: false });

      if (!error && data) {
        setStudents(data as Profile[]);
        setFiltered(data as Profile[]);
      }
      setLoading(false);
    }
    fetchStudents();
  }, []);

  useEffect(() => {
    const lower = search.toLowerCase();
    setFiltered(students.filter(s =>
      s.full_name?.toLowerCase().includes(lower) ||
      s.email?.toLowerCase().includes(lower) ||
      s.student_id?.toLowerCase().includes(lower)
    ));
  }, [search, students]);

  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggleActive(student: Profile) {
    setToggleError(null);
    // Admin writes go through a SECURITY DEFINER function that verifies the
    // caller is an active ADMIN (students cannot write is_active/role at all).
    const { data, error } = await supabase.rpc('admin_set_user_active', {
      p_user_id: student.id,
      p_active: !student.is_active,
    });

    if (error || !data) {
      setToggleError(error?.message || 'The update was not applied.');
      return;
    }

    setStudents(prev => prev.map(s => s.id === student.id ? (data as Profile) : s));
    setFiltered(prev => prev.map(s => s.id === student.id ? (data as Profile) : s));
    setSelectedStudent(prev => (prev && prev.id === student.id ? (data as Profile) : prev));
  }

  async function viewStudent(student: Profile) {
    setSelectedStudent(student);
    const [subsRes, solvedRes] = await Promise.all([
      supabase.from('submissions').select('*').eq('user_id', student.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('solved_problems').select('id', { count: 'exact', head: true }).eq('user_id', student.id),
    ]);
    setStudentSubs((subsRes.data as Submission[]) || []);
    setStudentSolved(solvedRes.count || 0);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-arena-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-arena-text">Students</h1>
        <p className="text-sm text-arena-subtle mt-1">Manage and monitor student accounts</p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arena-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field pl-10"
          placeholder="Search by name, email, or student ID..."
        />
      </div>

      {toggleError && (
        <div className="flex items-start gap-2 p-3 rounded-lg text-sm bg-arena-error/10 border border-arena-error/30 text-arena-error">
          <span>{toggleError}</span>
        </div>
      )}

      {/* Students table */}
      <div className="glass-card overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-arena-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Student ID</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider hidden md:table-cell">Email</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Solved</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Points</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-xs font-medium text-arena-muted uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8">
                  <Users className="w-8 h-8 text-arena-muted mx-auto mb-2" />
                  <p className="text-sm text-arena-subtle">No students found</p>
                </td>
              </tr>
            ) : (
              filtered.map((student) => (
                <tr key={student.id} className="border-b border-arena-border last:border-0 hover:bg-arena-surface/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="text-sm text-arena-subtle font-mono">{student.student_id || 'N/A'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center text-xs font-semibold text-arena-accent shrink-0">
                        {student.full_name?.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-arena-text font-medium">{student.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-sm text-arena-subtle">{student.email}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm text-arena-text">{student.problems_solved}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-amber-400">{student.total_points}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`badge ${student.is_active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-rose-500/30 bg-rose-500/10 text-rose-400'}`}>
                      {student.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => viewStudent(student)} className="p-1.5 rounded-lg hover:bg-arena-accent/10 text-arena-muted hover:text-arena-accent transition-colors" title="View details">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => toggleActive(student)} className="p-1.5 rounded-lg hover:bg-arena-accent/10 text-arena-muted hover:text-arena-accent transition-colors" title={student.is_active ? 'Disable' : 'Enable'}>
                        <UserCog className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Student detail modal */}
      {selectedStudent && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelectedStudent(null)}>
          <div className="glass-card max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-arena-text">Student Details</h3>
              <button onClick={() => setSelectedStudent(null)} className="text-arena-muted hover:text-arena-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-full bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center text-xl font-bold text-arena-accent">
                {selectedStudent.full_name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-lg font-bold text-arena-text">{selectedStudent.full_name}</p>
                <p className="text-sm text-arena-subtle">{selectedStudent.email}</p>
                <p className="text-xs text-arena-muted">{selectedStudent.student_id}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border text-center">
                <p className="text-xl font-bold text-amber-400">{selectedStudent.total_points}</p>
                <p className="text-xs text-arena-muted">Points</p>
              </div>
              <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border text-center">
                <p className="text-xl font-bold text-emerald-400">{studentSolved}</p>
                <p className="text-xs text-arena-muted">Solved</p>
              </div>
              <div className="p-3 rounded-lg bg-arena-bg/50 border border-arena-border text-center">
                <p className="text-xl font-bold text-sky-400">{selectedStudent.problems_attempted}</p>
                <p className="text-xs text-arena-muted">Attempted</p>
              </div>
            </div>

            <h4 className="text-sm font-semibold text-arena-text mb-2">Recent Submissions</h4>
            {studentSubs.length === 0 ? (
              <p className="text-sm text-arena-subtle text-center py-4">No submissions yet</p>
            ) : (
              <div className="space-y-2">
                {studentSubs.map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between p-3 rounded-lg bg-arena-bg/50 border border-arena-border">
                    <div>
                      <p className="text-sm text-arena-text">{sub.language.toUpperCase()}</p>
                      <p className="text-xs text-arena-muted">{new Date(sub.created_at).toLocaleString()}</p>
                    </div>
                    <span className={`badge ${sub.status === 'ACCEPTED' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-rose-500/30 bg-rose-500/10 text-rose-400'}`}>
                      {sub.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => toggleActive(selectedStudent)}
              className={`mt-6 w-full ${selectedStudent.is_active ? 'btn-danger' : 'btn-primary'}`}
            >
              {selectedStudent.is_active ? 'Disable Student' : 'Enable Student'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
