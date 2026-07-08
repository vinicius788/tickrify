import { Zap } from 'lucide-react';
import { useTicks } from '@/hooks/useTicks';

export function TicksBadge({ onClick }: { onClick?: () => void }) {
  const { balance } = useTicks();

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
    >
      <Zap className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
      <span>{balance}</span>
    </button>
  );
}
