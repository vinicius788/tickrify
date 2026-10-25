import { useLanguage } from '@/lib/i18n/LanguageContext';

export function PlanUnavailableNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-secondary)]">
      <span>{t.counter.planUnavailable}</span>
      <button type="button" onClick={onRetry} className="text-[var(--text-primary)] underline underline-offset-4">
        {t.common.retry}
      </button>
    </div>
  );
}
