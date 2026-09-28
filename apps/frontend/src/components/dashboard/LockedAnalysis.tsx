import { Loader2, Lock } from 'lucide-react';
import { useFoundingOffer } from '@/hooks/useFoundingOffer';

interface LockedAnalysisProps {
  /** Chamado quando o usuário clica em destravar (checkout; o EARLY35 entra se ainda estiver ativo). */
  onUnlock: () => void;
  /** Checkout do plano semanal (US$ 7,99, 25 analises por semana), sem cupom. */
  onUnlockWeekly?: () => void;
  /** True enquanto a sessão de checkout está sendo criada (cold start pode demorar). */
  unlockPending?: boolean;
  /** Rótulo do gráfico enviado (ex.: "BTCUSDT · 1H"). Sem valor, usa um genérico honesto. */
  symbolLabel?: string;
}

// Preview ESTÁTICO e borrado — não roda a IA (economiza processamento).
// O objetivo é mostrar que existe uma análise pronta ali, criando desejo de destravar.
// IMPORTANTE: nada legível aqui pode contradizer o gráfico que o usuário subiu.
const PREVIEW_ROWS: Array<{ label: string; value: string }> = [
  { label: 'Recommendation', value: 'BUY' },
  { label: 'Entry', value: '$ 4,261.40' },
  { label: 'Stop loss', value: '$ 4,240.00' },
  { label: 'Target 1', value: '$ 4,300.00' },
  { label: 'Target 2', value: '$ 4,320.00' },
  { label: 'Confidence', value: '80%' },
];

const LockedAnalysis = ({ onUnlock, onUnlockWeekly, unlockPending = false, symbolLabel }: LockedAnalysisProps) => {
  // O desconto so e anunciado com o cupom ativo na Stripe.
  const offer = useFoundingOffer();
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      {/* Camada borrada (preview estático) */}
      <div className="pointer-events-none select-none p-6 md:p-8" aria-hidden="true">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-terminal text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            {symbolLabel ?? 'Your chart'}
          </span>
          <span className="font-terminal text-xs text-[var(--text-secondary)]">Analysis ready</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {PREVIEW_ROWS.map((r) => (
            <div
              key={r.label}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3"
            >
              <p className="font-terminal text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                {r.label}
              </p>
              <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]" style={{ filter: 'blur(7px)' }}>
                {r.value}
              </p>
            </div>
          ))}
        </div>

        <div
          className="mt-3 h-16 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)]"
          style={{ filter: 'blur(7px)' }}
        />
      </div>

      {/* Overlay com cadeado + CTA */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgba(5,5,8,0.55)] px-6 text-center backdrop-blur-[2px]">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-primary)]">
          <Lock className="h-5 w-5" />
        </span>
        <h2 className="tk-display text-2xl text-[var(--text-primary)] md:text-3xl">
          Your read is ready. Unlock to see it.
        </h2>
        <p className="max-w-[420px] text-sm text-[var(--text-secondary)]">
          Entry, stop, targets and confidence, calculated for this chart. Your free analyses are used up.
        </p>
        <button
          type="button"
          onClick={onUnlock}
          disabled={unlockPending}
          className="mt-1 inline-flex items-center gap-2 rounded-xl bg-[var(--signal-buy)] px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {unlockPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Opening secure checkout…
            </>
          ) : (
            <>{offer?.percentOff ? `Unlock analysis, ${offer.percentOff}% off applied →` : 'Unlock analysis →'}</>
          )}
        </button>
        {offer?.percentOff ? (
          <p className="font-terminal text-[11px] text-[var(--text-secondary)]">
            Early user: your {offer.code} discount ({offer.percentOff}% off the first month, then $29/month) is applied automatically.
          </p>
        ) : null}
        {onUnlockWeekly ? (
          <button
            type="button"
            onClick={onUnlockWeekly}
            disabled={unlockPending}
            className="text-sm text-[var(--text-primary)] underline underline-offset-4 transition-opacity hover:opacity-80 disabled:opacity-60"
          >
            Or start with one week: $7.99 for 25 analyses
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default LockedAnalysis;
