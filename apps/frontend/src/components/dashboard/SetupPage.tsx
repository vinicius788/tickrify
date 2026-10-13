import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { APIError, isFreeQuotaExhausted } from '@/lib/api';
import {
  formatSetupDay,
  formatSetupMoment,
  useSetupActions,
  useSetupVersions,
  type SetupVersion,
} from '@/lib/setups';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

/**
 * Pagina de um setup (/dashboard/setups/:id, 12/10/2026): as versoes da mais
 * nova para a mais antiga. Cada uma diz de quando e ("Analysis from <data>"),
 * nunca "current", "live" ou "now": e a leitura daquele grafico, naquela hora.
 */
const SetupPage = ({
  setupId,
  base,
  onUpdate,
  paywall,
}: {
  setupId: string;
  base: string;
  onUpdate: (setupId: string) => void;
  /** Gratis esgotado e nenhuma versao entre as analises abertas. */
  paywall: () => ReactNode;
}) => {
  const { t, language } = useLanguage();
  const s = t.setups;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const { toast } = useToast();
  const query = useSetupVersions(setupId);
  const { follow, setStatus } = useSetupActions();

  if (query.isLoading) {
    return <p className="py-8 text-center text-sm text-[var(--text-secondary)]">{t.common.loading}</p>;
  }
  if (query.isError) {
    if (isFreeQuotaExhausted(query.error)) return <>{paywall()}</>;
    const notFound = query.error instanceof APIError && query.error.status === 404;
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>{notFound ? s.notFound : s.loadFailed}</AlertTitle>
        </Alert>
        <Link to={base} className="text-sm text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]">
          {s.back}
        </Link>
      </div>
    );
  }

  const pages = query.data?.pages ?? [];
  const setup = pages[0]?.setup;
  if (!setup) return null;
  const versions = pages.flatMap((page) => page.versions);
  const tracking = setup.status === 'tracking';
  const busy = follow.isPending || setStatus.isPending;
  const price = (value: number | null) => (value === null ? 'n/a' : value.toLocaleString(locale, { maximumFractionDigits: 6 }));
  const verdictLabel = (rec: SetupVersion['recommendation']) =>
    rec === 'BUY' ? t.analysis.buy : rec === 'SELL' ? t.analysis.sell : t.analysis.hold;
  const verdictTone = (rec: SetupVersion['recommendation']) =>
    rec === 'BUY' ? 'text-[var(--signal-buy)]' : rec === 'SELL' ? 'text-[var(--signal-sell)]' : 'text-[var(--signal-hold)]';

  const changeStatus = (status: 'untracked' | 'archived') =>
    setStatus.mutate(
      { setupId: setup.id, status },
      {
        onSuccess: () => toast({ title: status === 'archived' ? s.archived : s.unfollowed }),
        onError: () => toast({ title: s.actionFailed, variant: 'destructive' }),
      },
    );
  const followAgain = () => {
    track('setup_follow_clicked', { surface: 'setup_page', recommendation: versions[0]?.recommendation ?? null });
    follow.mutate(setup.rootAnalysisId, {
      onError: (error) => {
        if (error instanceof APIError && error.code === 'setup_limit') {
          toast({ title: s.limitTitle, description: s.limitDesc });
          return;
        }
        toast({ title: s.followFailed, variant: 'destructive' });
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="tk-eyebrow flex items-center gap-2 text-[11px]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
          {`${t.nav.workspace} / ${s.pageEyebrow}`}
        </div>
        <h1 className="tk-display mt-2 text-3xl md:text-4xl">
          {`${setup.symbol ?? 'N/A'} `}
          <span className="font-terminal text-lg text-[var(--text-secondary)]">{setup.timeframe ?? ''}</span>
        </h1>
        <p className="mt-2 font-terminal text-xs text-[var(--text-secondary)]">
          {tracking ? s.followingSince.replace('{date}', formatSetupDay(setup.createdAt, locale)) : s.notFollowing}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tracking ? (
          <>
            <button
              key="update"
              type="button"
              onClick={() => onUpdate(setup.id)}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
            >
              <RefreshCw className="h-4 w-4" /> {s.update}
            </button>
            <button
              key="unfollow"
              type="button"
              onClick={() => changeStatus('untracked')}
              disabled={busy}
              className="rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)] disabled:opacity-50"
            >
              {s.unfollow}
            </button>
            <button
              key="archive"
              type="button"
              onClick={() => changeStatus('archived')}
              disabled={busy}
              className="rounded-xl px-3 py-2.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {s.archive}
            </button>
          </>
        ) : (
          <button
            key="follow-again"
            type="button"
            onClick={followAgain}
            disabled={busy}
            className="rounded-xl bg-[var(--inverse-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {s.followAgain}
          </button>
        )}
      </div>

      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <h2 className="tk-stat-label">{s.versionsTitle}</h2>
        <ol className="mt-3 divide-y divide-[var(--border-subtle)]">
          {versions.map((v) => (
            <li key={v.analysisId} className="py-3 first:pt-0 last:pb-0">
              <Link
                to={`${base}/analysis/${encodeURIComponent(v.analysisId)}`}
                className="group flex flex-col gap-2 rounded-lg transition-colors"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-[var(--text-primary)] group-hover:underline">
                    {s.analysisFrom.replace('{date}', formatSetupMoment(v.createdAt, locale))}
                  </p>
                  <p className="font-terminal text-[11px] text-[var(--text-secondary)]">
                    {`${s.version.replace('{n}', String(v.version))} · `}
                    <span className={`font-semibold ${verdictTone(v.recommendation)}`}>{verdictLabel(v.recommendation)}</span>
                  </p>
                </div>
                {v.recommendation === 'WAIT' ? (
                  v.entryCondition ? (
                    <p className="text-xs leading-relaxed text-[var(--text-primary)]/85">
                      {s.waitingFor.replace('{condition}', v.entryCondition).replace('{date}', formatSetupDay(v.createdAt, locale))}
                    </p>
                  ) : null
                ) : (
                  <dl className="grid grid-cols-2 gap-2 font-terminal text-xs sm:grid-cols-4">
                    {([
                      [s.entry, v.entry],
                      [s.stop, v.stopLoss],
                      [s.tp1, v.takeProfit1],
                      [s.tp2, v.takeProfit2],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2">
                        <dt className="text-[var(--text-secondary)]">{label}</dt>
                        <dd className="mt-0.5 text-[var(--text-primary)]">{price(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Link>
            </li>
          ))}
        </ol>
        {query.hasNextPage ? (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="mt-4 font-terminal text-xs text-[var(--accent-green)] underline-offset-2 hover:underline disabled:opacity-50"
          >
            {s.loadMore}
          </button>
        ) : null}
      </section>
    </div>
  );
};

export default SetupPage;
