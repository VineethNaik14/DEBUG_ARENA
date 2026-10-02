import { Bug } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-arena-bg flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-arena-accent/10 border border-arena-accent/30 flex items-center justify-center animate-pulse-glow">
          <Bug className="w-6 h-6 text-arena-accent" />
        </div>
        <p className="text-arena-subtle text-sm font-medium">Loading Debug Arena...</p>
      </div>
    </div>
  );
}
