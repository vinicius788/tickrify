import { useLanguage } from '@/lib/i18n/LanguageContext';
import { asRecord } from '@/lib/utils';

/** Mostra fatos sobre a entrada do modelo; não infere a época do screenshot. */
export function AnalysisEvidencePanel({ evidence: value }: { evidence: unknown }) {
  const { t } = useLanguage();
  const raw = asRecord(value);
  const evidence = raw.version === 1 ? raw : null;
  const additionalDelivered = evidence && Number.isSafeInteger(evidence.additionalChartsDelivered)
    ? Math.max(0, Math.min(2, Number(evidence.additionalChartsDelivered))) : 0;
  const calendar = evidence?.calendar === 'events_attached'
    ? t.analysis.evidenceEventsAttached
    : evidence?.calendar === 'no_events_returned'
      ? t.analysis.evidenceNoEventsReturned
      : evidence?.calendar === 'not_attached'
        ? t.analysis.evidenceNotAttached
        : t.analysis.evidenceNotConfirmed;

  return (
    <div className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-secondary)]">
      <p className="font-terminal font-semibold uppercase tracking-wide text-[var(--text-primary)]">
        {t.analysis.evidenceTitle}
      </p>
      {evidence ? (
        <>
          <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <div><dt className="inline">{t.analysis.evidenceCharts}: </dt><dd className="inline text-[var(--text-primary)]">{1 + additionalDelivered}</dd></div>
            <div><dt className="inline">{t.analysis.evidenceAdditionalCharts}: </dt><dd className="inline text-[var(--text-primary)]">{additionalDelivered}</dd></div>
            <div><dt className="inline">{t.analysis.evidenceCandles}: </dt><dd className="inline text-[var(--text-primary)]">{evidence.candleFeedAttached === true ? t.analysis.evidenceAttached : t.analysis.evidenceNotAttached}</dd></div>
            <div><dt className="inline">{t.analysis.evidenceMarketContext}: </dt><dd className="inline text-[var(--text-primary)]">{evidence.marketContextAttached === true ? t.analysis.evidenceAttached : t.analysis.evidenceNotAttached}</dd></div>
            <div className="sm:col-span-2"><dt className="inline">{t.analysis.evidenceCalendar}: </dt><dd className="inline text-[var(--text-primary)]">{calendar}</dd></div>
          </dl>
          <p className="mt-2">{t.analysis.evidenceTimeNote}</p>
        </>
      ) : <p className="mt-2">{t.analysis.evidenceLegacy}</p>}
    </div>
  );
}
