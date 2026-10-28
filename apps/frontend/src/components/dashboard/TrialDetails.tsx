import type { TrialUsage } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/** Account-specific copy shared by the sidebar and the mobile dashboard. */
export default function TrialDetails({ trial }: { trial: TrialUsage }) {
  const { t, language } = useLanguage();
  const c = t.commercial;
  const format = (value: string) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toLocaleString(language, {
      dateStyle: 'medium', timeStyle: 'short', timeZone: trial.timezone,
    }) + (trial.timezone ? ` (${trial.timezone})` : '');
  };
  const end = format(trial.windowEndsAt);
  const next = trial.nextAvailableAt ? format(trial.nextAvailableAt) : null;
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
      <p>{c.trialRules}</p>
      <p>{c.trialEndRule}</p>
      {end ? <p>{c.trialWindow.replace('{date}', end)}</p> : null}
      {trial.status === 'active' && trial.paywall === 'daily_limit' && trial.nextAvailableAt !== undefined ? (
        <p>{next ? c.trialNext.replace('{date}', next) : c.trialNoNext}</p>
      ) : null}
      {trial.status === 'ended' ? <p>{trial.paywall === 'expired' ? c.trialExpired : c.trialCompleted}</p> : null}
    </div>
  );
}
