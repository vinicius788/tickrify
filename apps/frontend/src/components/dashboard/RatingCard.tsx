import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Star } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import {
  addRatingDetails,
  markRatingAnswered,
  markRatingAsked,
  rateAnalysis,
  shouldAskRating,
  type RatingReason,
} from '@/lib/ratings';

type Step = 'stars' | 'good' | 'bad' | 'thanks';

/**
 * "How useful was this read?" abaixo do resultado de uma analise paga
 * (07/10/2026). Um toque nas estrelas ja grava a nota; o resto e opcional.
 * Nota alta pede uma frase e a licenca para citar no site; nota baixa pergunta
 * o que faltou (lista fechada). Nunca trava nada: no maximo 1 vez por semana,
 * e quem respondeu fica 30 dias sem ver.
 */
const RatingCard = ({ analysisId }: { analysisId: string }) => {
  const { t } = useLanguage();
  const r = t.rating;
  const { getToken } = useAuth();
  // Decide UMA vez na montagem: marcar "perguntado" nao pode sumir com o cartao na hora.
  const [visible, setVisible] = useState(() => shouldAskRating());
  const [step, setStep] = useState<Step>('stars');
  const [hover, setHover] = useState(0);
  const [ratingId, setRatingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<RatingReason[]>([]);
  const [comment, setComment] = useState('');
  // Licenca so marcada pela propria pessoa (consentimento pre-marcado nao vale).
  const [consent, setConsent] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    markRatingAsked();
    track('rating_card_viewed');
  }, [visible]);

  if (!visible) return null;

  const rate = async (value: number) => {
    setError('');
    setStep(value >= 4 ? 'good' : 'bad');
    markRatingAnswered();
    track('rating_given', { rating: value });
    try {
      const token = await getToken();
      if (!token) return;
      const saved = await rateAnalysis(analysisId, value, token);
      setRatingId(saved.id);
    } catch {
      setError(r.error);
    }
  };

  const sendDetails = async (good: boolean) => {
    if (!ratingId || sending) {
      setStep('thanks');
      return;
    }
    setSending(true);
    setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('no_token');
      await addRatingDetails(
        ratingId,
        good
          ? { comment: comment.trim(), quoteConsent: consent && Boolean(comment.trim()), displayName: displayName.trim() || undefined }
          : { reasons, comment: comment.trim() },
        token,
      );
      // So numeros: o texto nunca vai ao PostHog.
      track('rating_details_sent', { good, reasons: reasons.length, hasComment: Boolean(comment.trim()), consent: good && consent });
      setStep('thanks');
    } catch {
      setError(r.error);
    } finally {
      setSending(false);
    }
  };

  const reasonLabels: Array<[RatingReason, string]> = [
    ['levels_off', r.reasonLevels],
    ['too_many_waits', r.reasonWaits],
    ['hard_to_understand', r.reasonHard],
    ['too_slow', r.reasonSlow],
    ['wrong_symbol', r.reasonSymbol],
    ['other', r.reasonOther],
  ];

  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      {step === 'stars' ? (
        <div key="stars">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{r.question}</p>
          <p className="text-xs text-[var(--text-secondary)]">{r.hint}</p>
          <div className="mt-3 flex gap-2" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={r.star.replace('{n}', String(value))}
                onMouseEnter={() => setHover(value)}
                onClick={() => void rate(value)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] transition-colors hover:border-amber-400"
              >
                <Star className={`h-5 w-5 ${value <= hover ? 'fill-amber-400 text-amber-400' : 'text-[var(--text-secondary)]'}`} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              track('rating_card_dismissed');
              setVisible(false);
            }}
            className="mt-2 text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            {r.notNow}
          </button>
        </div>
      ) : step === 'good' ? (
        <div key="good" className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{r.goodTitle}</p>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 500))}
            placeholder={r.goodPlaceholder}
            rows={3}
            className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-3 text-base text-[var(--text-primary)]"
          />
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
            <span>{r.consent}</span>
          </label>
          {consent ? (
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value.slice(0, 40))}
              placeholder={r.namePlaceholder}
              className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-base text-[var(--text-primary)]"
            />
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={sending}
              onClick={() => void sendDetails(true)}
              className="rounded-xl bg-[var(--signal-buy)] px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
            >
              {r.send}
            </button>
            <button type="button" onClick={() => setStep('thanks')} className="text-xs text-[var(--text-secondary)] underline">
              {r.skip}
            </button>
          </div>
        </div>
      ) : step === 'bad' ? (
        <div key="bad" className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{r.badTitle}</p>
          <div className="flex flex-wrap gap-2">
            {reasonLabels.map(([key, label]) => {
              const on = reasons.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setReasons((list) => (on ? list.filter((item) => item !== key) : [...list, key]))}
                  className={`rounded-full border px-3 py-1.5 text-xs ${on ? 'border-[var(--accent-green)] text-[var(--text-primary)]' : 'border-[var(--border-default)] text-[var(--text-secondary)]'}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 500))}
            placeholder={r.badPlaceholder}
            rows={3}
            className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] p-3 text-base text-[var(--text-primary)]"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={sending}
              onClick={() => void sendDetails(false)}
              className="rounded-xl bg-[var(--signal-buy)] px-5 py-2 text-sm font-semibold text-black disabled:opacity-60"
            >
              {r.send}
            </button>
            <button type="button" onClick={() => setStep('thanks')} className="text-xs text-[var(--text-secondary)] underline">
              {r.skip}
            </button>
          </div>
        </div>
      ) : (
        <div key="thanks">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{r.thanksTitle}</p>
          <p className="text-xs text-[var(--text-secondary)]">{r.thanksDesc}</p>
        </div>
      )}
      {error ? (
        <p key="error" role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
};

export default RatingCard;
