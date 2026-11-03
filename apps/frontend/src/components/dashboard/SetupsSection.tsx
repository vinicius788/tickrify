import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { useAPIClient, type SignalState, type StrategyProfileDto } from '@/lib/api';
import { resolveSignalState, signalStateTone } from '@/lib/trading-ui';
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
 * preco atual. Setup com alerta de nivel ativo sai daqui (`hiddenSetupIds`):
 * aparece no bloco Today, com o nivel e o ultimo preco checado.
 */
const SetupsSection = ({
  base,
  hiddenSetupIds,
}: {
  base: string;
  hiddenSetupIds?: ReadonlySet<string>;
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

  const items = (data?.items ?? []).filter((setup) => !hiddenSetupIds?.has(setup.id));
  // Estado do copiloto pelo servidor; cor de direcao so em ordem/entrada.
  const verdictLabel = (v: { recommendation: string; signalState?: SignalState }) =>
    t.analysis.states[resolveSignalState(v.signalState, v.recommendation)];
  const verdictTone = (v: { recommendation: string; signalState?: SignalState }) => {
    const tone = signalStateTone(resolveSignalState(v.signalState, v.recommendation), v.recommendation);
    return tone === 'buy' ? 'text-[var(--signal-buy)]' : tone === 'sell' ? 'text-[var(--signal-sell)]' : 'text-[var(--signal-hold)]';
  };

  const archive = (setup: FollowedSetup) =>
    setStatus.mutate(
      { setupId: setup.id, status: 'archived' },
      {
        onSuccess: () => toast({ title: s.archived }),
        onError: () => toast({ title: s.actionFailed, variant: 'destructive' }),
      },
    );

  const showList = !isError && items.length > 0;
  // Sem perfil salvo e sem setup fora do Today: nada a mostrar (o "New Analysis"
  // fica no cartao de boas-vindas e a frase de como comecar, no Today).
  if (!strategySummary && !showList) return null;

  return (
    <section aria-label={s.sectionTitle} className="flex flex-col gap-3">
      {strategySummary ? (
        <p key="strategy" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          <span className="text-[var(--text-primary)]">{`${s.strategyLabel}: `}</span>
          <span>{strategySummary}</span>{' '}
          <Link to={`${base}/strategy`} className="underline underline-offset-2 hover:text-[var(--text-primary)]">
            {s.strategyEdit}
          </Link>
        </p>
      ) : null}

      {!showList ? null : (
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
                        <span className={`ml-2 text-xs font-semibold ${verdictTone(latest)}`}>
                          {verdictLabel(latest)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 font-terminal text-[11px] text-[var(--text-secondary)]">
                      {`${s.firstAnalysis.replace('{date}', formatSetupDay(setup.firstAnalysisAt, locale))} · ${s.updated
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
                      className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
                    >
                      {s.open}
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        track('setup_update_clicked', { setupId: setup.id });
                        navigate(`${base}/new?setup=${encodeURIComponent(setup.id)}`);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--inverse-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
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
