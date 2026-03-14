import { Zap } from 'lucide-react';
import { useTicks } from '@/hooks/useTicks';

export function TicksBadge({ onClick }: { onClick?: () => void }) {
  const { balance } = useTicks();

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
    >
      <Zap className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
      <span className="font-terminal font-medium">{balance}</span>
      <span className="text-[var(--text-secondary)]">Ticks</span>
    </button>
  );
}
