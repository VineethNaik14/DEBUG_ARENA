import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, Info, AlertCircle, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatRelativeTime } from '@/utils/helpers';
import type { Notification } from '@/types';

export function NotificationsPage() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNotifications() {
      if (!profile) return;
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setNotifications(data as Notification[]);
      }
      setLoading(false);
    }
    fetchNotifications();

    const channel = supabase
      .channel('notifications-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile?.id}` }, (payload) => {
        setNotifications(prev => [payload.new as Notification, ...prev]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile]);

  async function markAsRead(id: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  async function markAllAsRead() {
    if (!profile) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  function getIcon(type: string) {
    switch (type) {
      case 'SUCCESS': return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
      case 'WARNING': return <AlertCircle className="w-5 h-5 text-amber-400" />;
      default: return <Info className="w-5 h-5 text-sky-400" />;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-arena-subtle text-sm">Loading notifications...</div>
      </div>
    );
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-arena-text">Notifications</h1>
          <p className="text-sm text-arena-subtle mt-1">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllAsRead} className="btn-secondary text-sm flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Bell className="w-10 h-10 text-arena-muted mx-auto mb-3" />
          <p className="text-arena-subtle">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif, i) => (
            <div
              key={notif.id}
              className={`glass-card p-4 flex items-start gap-3 animate-slide-up ${!notif.is_read ? 'border-arena-accent/30' : ''}`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="mt-0.5 shrink-0">{getIcon(notif.type)}</div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${notif.is_read ? 'text-arena-subtle' : 'text-arena-text font-medium'}`}>
                  {notif.title || 'Notification'}
                </p>
                {notif.message && (
                  <p className="text-sm text-arena-subtle mt-0.5">{notif.message}</p>
                )}
                <p className="text-xs text-arena-muted mt-1">{formatRelativeTime(notif.created_at)}</p>
              </div>
              {!notif.is_read && (
                <button onClick={() => markAsRead(notif.id)} className="shrink-0 text-xs text-arena-accent hover:underline">
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
