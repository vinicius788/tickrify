import { Loader2, Lock } from 'lucide-react';
import { useFoundingOffer } from '@/hooks/useFoundingOffer';
import UpgradeVideo from './UpgradeVideo';

interface LockedAnalysisProps {
  /** Checkout do mensal (o EARLY35 entra se ainda estiver ativo). */
  onUnlock: () => void;
  /** Checkout do plano semanal (US$ 7,99, 25 analises por semana), sem cupom. */
  onUnlockWeekly?: () => void;
  /** True enquanto a sessão de checkout está sendo criada (cold start pode demorar). */
  unlockPending?: boolean;
}

// Preview ESTÁTICO e borrado: NÃO roda a IA. Por isso o texto nunca pode dizer
// que existe uma análise pronta deste gráfico (dizia "Your read is ready" e
// "calculated for this chart" até 29/09, e nenhuma análise rodava). O rótulo
// diz o que é: o formato da leitura que o assinante recebe.
const PREVIEW_ROWS: Array<{ label: string; value: string }> = [
  { label: 'Bias', value: '•••••••' },
  { label: 'Entry', value: '$ 4,261.40' },
  { label: 'Stop loss', value: '$ 4,240.00' },
  { label: 'Target 1', value: '$ 4,300.00' },
  { label: 'Target 2', value: '$ 4,320.00' },
  { label: 'R/R to TP1', value: '1.8 : 1' },
];

const MONTHLY_PRICE_USD = 29;

const LockedAnalysis = ({ onUnlock, onUnlockWeekly, unlockPending = false }: LockedAnalysisProps) => {
  // O desconto so e anunciado com o cupom ativo na Stripe.
  const offer = useFoundingOffer();
  const firstMonth = offer?.percentOff
    ? (MONTHLY_PRICE_USD * (1 - offer.percentOff / 100)).toFixed(2)
    : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
        {/* Camada borrada (preview estático) */}
        <div className="pointer-events-none select-none p-6 md:p-8" aria-hidden="true">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-terminal text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              Your chart
            </span>
            <span className="font-terminal text-xs text-[var(--text-secondary)]">What every read includes</span>
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgba(5,5,8,0.62)] px-6 text-center backdrop-blur-[2px]">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-primary)]">
            <Lock className="h-5 w-5" />
          </span>
          <h2 className="tk-display text-2xl text-[var(--text-primary)] md:text-3xl">
            Your free trade calls are used up
          </h2>
          <p className="max-w-[420px] text-sm text-[var(--text-secondary)]">
            Subscribe to analyze this chart and the next ones: entry, stop, targets, risk and the reasoning on every read.
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
            ) : firstMonth ? (
              <>Subscribe, ${firstMonth} first month →</>
            ) : (
              <>Subscribe, ${MONTHLY_PRICE_USD}/month →</>
            )}
          </button>
          {offer?.percentOff ? (
            <p className="font-terminal text-[11px] text-[var(--text-secondary)]">
              Early user: {offer.code} ({offer.percentOff}% off the first month) is applied automatically. Then ${MONTHLY_PRICE_USD}/month, cancel anytime.
            </p>
          ) : null}
          {onUnlockWeekly ? (
            <button
              type="button"
              onClick={onUnlockWeekly}
              disabled={unlockPending}
              className="inline-flex items-center rounded-xl border border-[var(--border-default)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-white/[0.04] disabled:opacity-60"
            >
              Or one week: $7.99 for 25 analyses
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 md:p-5">
        <UpgradeVideo
          surface="locked"
          caption="Subscribers can also send the entry chart plus up to two higher timeframes and get one combined read. 20 seconds."
        />
      </div>
    </div>
  );
};

export default LockedAnalysis;
