import { Zap } from 'lucide-react';
import { useTicks } from '@/hooks/useTicks';

export function TicksBadge({ onClick }: { onClick?: () => void }) {
  const { balance } = useTicks();

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
    >
      <Zap className="h-3 w-3 fill-yellow-400 text-yellow-400" />
      <span>{balance}</span>
      <span className="hidden font-normal text-muted-foreground sm:inline">Ticks</span>
    </button>
  );
}
