import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Lock } from 'lucide-react';
import { useFoundingOffer } from '@/hooks/useFoundingOffer';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import UpgradeVideo from './UpgradeVideo';
import { useTestimonials } from '@/lib/ratings';

/**
 * Onde o paywall apareceu. Vai em todo evento (`upgrade_cta_viewed`,
 * `upgrade_cta_clicked`, `upgrade_clicked`, `checkout_started`) para o funil
 * separar "acabou a analise gratis" de "quis abrir o diario".
 */
export type PaywallSurface = 'new_analysis' | 'trades' | 'journal' | 'history';

interface PaywallProps {
  surface: PaywallSurface;
  /**
   * Checkout do semanal (US$ 7,99, 25 analises), o botao PRINCIPAL desde
   * 05/10/2026: em 14 dias, 13 abriram o checkout e 1 pagou, quase todos de
   * paises onde US$ 29 de uma vez pesa e o cartao recusa.
   */
  onWeekly: () => void;
  /** Checkout do mensal (o EARLY35 entra se ainda estiver ativo, e so no mensal). */
  onMonthly: () => void;
  /** True enquanto a sessão de checkout está sendo criada (cold start pode demorar). */
  unlockPending?: boolean;
  /** Planos dentro do painel (o anual mora la). */
  plansHref: string;
  /** O que continua aberto para leitura (ex.: as 3 ultimas analises). */
  children?: ReactNode;
}

const MONTHLY_PRICE_USD = 29;

/**
 * Paywall UNICO do painel (05/10/2026): nova analise, My Trades, diario e
 * historico usam este componente, cada um com a sua `surface`. Antes so a nova
 * analise tinha paywall, com texto fixo em ingles.
 *
 * O preview e ESTATICO e borrado: NAO roda a IA. Por isso o texto nunca pode
 * dizer que existe uma analise pronta deste grafico (dizia "Your read is ready"
 * ate 29/09, e nenhuma analise rodava). O rotulo diz o que e: o formato da
 * leitura que o assinante recebe.
 */
const Paywall = ({ surface, onWeekly, onMonthly, unlockPending = false, plansHref, children }: PaywallProps) => {
  const { t } = useLanguage();
  const p = t.paywall;
  // Uma frase real de assinante, so com 2+ depoimentos publicados (com licenca).
  const quote = useTestimonials()[0];
  // O desconto so e anunciado com o cupom ativo na Stripe, e so vale no mensal.
  const offer = useFoundingOffer();
  const firstMonth = offer?.percentOff
    ? (MONTHLY_PRICE_USD * (1 - offer.percentOff / 100)).toFixed(2)
    : null;

  useEffect(() => {
    track('upgrade_cta_viewed', { source: 'paywall', surface });
  }, [surface]);

  const title = surface === 'new_analysis' ? p.titleNewAnalysis : p.titleArea;
  const description =
    surface === 'trades'
      ? p.descTrades
      : surface === 'journal'
        ? p.descJournal
        : surface === 'history'
          ? p.descHistory
          : p.descNewAnalysis;
  const preview: Array<{ label: string; value: string }> = [
    { label: p.previewScenario, value: '•••••••' },
    { label: p.previewEntry, value: '$ 4,261.40' },
    { label: p.previewStop, value: '$ 4,240.00' },
    { label: p.previewTp1, value: '$ 4,300.00' },
    { label: p.previewTp2, value: '$ 4,320.00' },
    { label: p.previewRr, value: '1.8 : 1' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
        {/* Camada borrada (preview estático) */}
        <div className="pointer-events-none select-none p-6 md:p-8" aria-hidden="true">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-terminal text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              {p.yourChart}
            </span>
            <span className="font-terminal text-xs text-[var(--text-secondary)]">{p.includesTitle}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {preview.map((r) => (
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-[rgba(5,5,8,0.7)] px-6 py-6 text-center backdrop-blur-[2px]">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-primary)]">
            <Lock className="h-5 w-5" />
          </span>
          <h2 className="tk-display text-2xl text-[var(--text-primary)] md:text-3xl">{title}</h2>
          <p className="max-w-[440px] text-sm text-[var(--text-secondary)]">{description}</p>
          <button
            type="button"
            onClick={onWeekly}
            disabled={unlockPending}
            className="mt-1 inline-flex items-center gap-2 rounded-xl bg-[var(--signal-buy)] px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {unlockPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{p.opening}</span>
              </>
            ) : (
              <span>{p.ctaWeekly}</span>
            )}
          </button>
          <button
            type="button"
            onClick={onMonthly}
            disabled={unlockPending}
            className="inline-flex items-center rounded-xl border border-[var(--border-default)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-white/[0.04] disabled:opacity-60"
          >
            {firstMonth ? p.orMonthlyFirst.replace('{price}', `$${firstMonth}`) : p.orMonthly}
          </button>
          {offer?.percentOff ? (
            <p className="max-w-[440px] font-terminal text-[11px] text-[var(--text-secondary)]">
              {p.offerNote.replace('{code}', offer.code).replace('{pct}', String(offer.percentOff))}
            </p>
          ) : null}
          <Link
            to={plansHref}
            onClick={() => track('upgrade_cta_clicked', { source: 'paywall', surface, destination: 'plans' })}
            className="text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            {p.allPlans}
          </Link>
          {quote ? (
            <p className="max-w-[440px] text-xs italic text-[var(--text-secondary)]">
              &ldquo;{quote.comment}&rdquo; · {[quote.displayName, quote.country].filter(Boolean).join(', ') || t.rating.subscriber}
            </p>
          ) : null}
        </div>
      </div>

      <ul className="grid gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-primary)] sm:grid-cols-2 md:p-5">
        {[p.benefit1, p.benefit2, p.benefit3, p.benefit4].map((benefit) => (
          <li key={benefit} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--signal-buy)]" />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>

      {children}

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 md:p-5">
        <UpgradeVideo surface="locked" caption={p.videoCaption} />
      </div>
    </div>
  );
};

export default Paywall;
