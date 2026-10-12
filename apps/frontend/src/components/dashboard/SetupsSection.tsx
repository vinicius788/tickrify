import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, PlusCircle, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { useAPIClient, type StrategyProfileDto } from '@/lib/api';
import {
  formatSetupDay,
  formatSetupRelative,
  useFollowedSetups,
  useSetupActions,
  type FollowedSetup,
} from '@/lib/setups';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

/**
 * Topo do inicio do painel (12/10/2026): uma linha de preparacao (perfil de
 * estrategia salvo + nova analise) e os setups que a pessoa segue. Nada aqui
 * bloqueia ou obriga: sem perfil (ou no gratis) a linha so tem o atalho, e sem
 * setups aparece uma frase dizendo como seguir um.
 *
 * Honesto sobre o tempo: cada cartao mostra a data da ultima LEITURA, nunca
 * preco atual, "monitoring" ou alerta. Nada e acompanhado ao vivo.
 */
const SetupsSection = ({
  base,
  onNewAnalysis,
  showEmpty,
}: {
  base: string;
  onNewAnalysis: () => void;
  /** Frase de "como seguir" so para quem ja tem analise (o painel vazio ja ensina o primeiro passo). */
  showEmpty: boolean;
}) => {
  const { t, language } = useLanguage();
  const s = t.setups;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const navigate = useNavigate();
  const { toast } = useToast();
  const apiClient = useAPIClient();
  const { data, isError } = useFollowedSetups(true);
  const { setStatus } = useSetupActions();
  const [profile, setProfile] = useState<StrategyProfileDto | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .getStrategy()
      .then((res) => {
        if (alive && res.paid) setProfile(res.profile);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [apiClient]);

  const st = t.strategy;
  const instrumentLabel: Record<string, string> = {
    crypto: st.instrumentCrypto, forex: st.instrumentForex, metals: st.instrumentMetals,
    indices: st.instrumentIndices, stocks: st.instrumentStocks,
  };
  const setupLabel: Record<string, string> = {
    breakout: st.setupBreakout, pullback: st.setupPullback, reversal: st.setupReversal,
    range: st.setupRange, trend_continuation: st.setupTrendContinuation,
  };
  const strategySummary = profile
    ? [
        profile.instruments.map((v) => instrumentLabel[v] ?? v).join(', '),
        profile.timeframes.join(', '),
        profile.setups.map((v) => setupLabel[v] ?? v).join(', '),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const items = data?.items ?? [];
  const verdictLabel = (rec: string) => (rec === 'BUY' ? t.analysis.buy : rec === 'SELL' ? t.analysis.sell : t.analysis.hold);
  const verdictTone = (rec: string) =>
    rec === 'BUY' ? 'text-[var(--signal-buy)]' : rec === 'SELL' ? 'text-[var(--signal-sell)]' : 'text-[var(--signal-hold)]';

  const archive = (setup: FollowedSetup) =>
    setStatus.mutate(
      { setupId: setup.id, status: 'archived' },
      {
        onSuccess: () => toast({ title: s.archived }),
        onError: () => toast({ title: s.actionFailed, variant: 'destructive' }),
      },
    );

  return (
    <section aria-label={s.sectionTitle} className="flex flex-col gap-3">
      {/* Preparacao: uma linha so, nunca uma etapa obrigatoria. */}
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        {strategySummary ? (
          <p key="strategy" className="min-w-0 text-xs leading-relaxed text-[var(--text-secondary)]">
            <span className="text-[var(--text-primary)]">{`${s.strategyLabel}: `}</span>
            <span>{strategySummary}</span>{' '}
            <Link to={`${base}/strategy`} className="underline underline-offset-2 hover:text-[var(--text-primary)]">
              {s.strategyEdit}
            </Link>
          </p>
        ) : (
          <span key="no-strategy" />
        )}
        <button
          type="button"
          onClick={onNewAnalysis}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white/[0.04] sm:self-auto"
        >
          <PlusCircle className="h-3.5 w-3.5" /> {t.nav.newAnalysis}
        </button>
      </div>

      {isError ? null : items.length === 0 ? (
        showEmpty && data ? (
          <p key="empty" className="px-1 text-xs text-[var(--text-secondary)]">{s.empty}</p>
        ) : null
      ) : (
        <div key="list" className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
          <h2 className="tk-stat-label">{s.sectionTitle}</h2>
          <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
            {items.map((setup) => {
              const latest = setup.latest;
              return (
                <li key={setup.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="font-terminal text-sm text-[var(--text-primary)]">
                      {`${setup.symbol ?? 'N/A'} `}
                      <span className="text-xs text-[var(--text-secondary)]">{setup.timeframe ?? ''}</span>
                      {latest ? (
                        <span className={`ml-2 text-xs font-semibold ${verdictTone(latest.recommendation)}`}>
                          {verdictLabel(latest.recommendation)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 font-terminal text-[11px] text-[var(--text-secondary)]">
                      {`${s.firstAnalysis.replace('{date}', formatSetupDay(setup.createdAt, locale))} · ${s.updated
                        .replace('{relative}', formatSetupRelative(setup.lastAnalysisAt, locale))
                        .replace('{date}', formatSetupDay(setup.lastAnalysisAt, locale))}`}
                    </p>
                    {latest && latest.recommendation === 'WAIT' && latest.entryCondition ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-primary)]/85">
                        {s.waitingFor
                          .replace('{condition}', latest.entryCondition)
                          .replace('{date}', formatSetupDay(latest.createdAt, locale))}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link
                      to={`${base}/setups/${encodeURIComponent(setup.id)}`}
                      onClick={() => track('setup_opened', { setupId: setup.id, surface: 'home' })}
                      className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white/[0.04]"
                    >
                      {s.open}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        track('setup_update_clicked', { setupId: setup.id });
                        navigate(`${base}/new?setup=${encodeURIComponent(setup.id)}`);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#050508] transition-opacity hover:opacity-90"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> {s.update}
                    </button>
                    <button
                      type="button"
                      onClick={() => archive(setup)}
                      disabled={setStatus.isPending}
                      aria-label={`${s.archive} ${setup.symbol ?? ''}`}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
                    >
                      <Archive className="h-3.5 w-3.5" /> {s.archive}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};

export default SetupsSection;
