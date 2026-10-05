import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Coins, Gift } from 'lucide-react';
import { useTicks } from '@/hooks/useTicks';
import AnalysisCounter from '@/components/dashboard/AnalysisCounter';

/**
 * Saldo e plano no topo do painel. Clicar em qualquer um dos dois abre o
 * cartao do plano (saldo, renovacao e "Manage subscription").
 *
 * 05/10/2026: o cartao com a barra verde ficava fixo na lateral para o
 * assinante e o dono achou poluido; agora ele so aparece quando a pessoa pede.
 * O gratis continua vendo o contador na lateral (e o empurrao para assinar).
 * O raio (Zap) saiu: icone de moedas para o saldo, selo para o plano ativo.
 */
export function TicksBadge({
  showBalance,
  planText,
  planSub,
  subscriber,
}: {
  showBalance: boolean;
  planText: string;
  planSub: string;
  subscriber: boolean;
}) {
  const { balance } = useTicks();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => setOpen((value) => !value);
  const PlanIcon = subscriber ? BadgeCheck : Gift;

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center gap-1.5 md:gap-3">
      {showBalance && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`${balance} Ticks`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <Coins className="h-3.5 w-3.5 text-[var(--accent-green)]" />
          <span>{balance}</span>
        </button>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
      >
        <PlanIcon className="h-3.5 w-3.5 text-[var(--accent-green)]" />
        <span className="whitespace-nowrap">{planText}</span>
        {planSub ? <span className="hidden whitespace-nowrap text-[var(--text-secondary)] md:inline">{planSub}</span> : null}
      </button>

      {open && (
        <div role="dialog" aria-label={planText} className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-24px)]">
          <AnalysisCounter />
        </div>
      )}
    </div>
  );
}
