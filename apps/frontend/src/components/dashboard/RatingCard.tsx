import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Star } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import {
  addRatingDetails,
  addUsefulnessReasons, getUsefulnessEligibility, rateUsefulness,
  shouldAskUsefulness, markUsefulnessAsked, markUsefulnessAnswered,
  type UsefulnessEligibility, type UsefulnessReason,
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
const StarRatingCard = ({ analysisId }: { analysisId: string }) => {
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
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-default)] transition-colors hover:border-[var(--tone-warn-2)]"
              >
                <Star className={`h-5 w-5 ${value <= hover ? 'fill-[var(--tone-star)] text-[var(--tone-warn-2)]' : 'text-[var(--text-secondary)]'}`} />
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
              className="rounded-xl bg-[var(--signal-buy)] px-5 py-2 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-60"
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
              className="rounded-xl bg-[var(--signal-buy)] px-5 py-2 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-60"
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
        <p key="error" role="alert" className="mt-2 text-xs text-[var(--tone-down-2)]">
          {error}
        </p>
      ) : null}
    </section>
  );
};

/** Free/trial variant reuses the rating card, endpoints, spacing and optional reason chips. */
function UsefulnessRatingCard({ analysisId, userId }: { analysisId: string; userId: string }) {
  const { t } = useLanguage();
  const { getToken } = useAuth();
  const [context, setContext] = useState<UsefulnessEligibility | null>(null);
  const [step, setStep] = useState<'question' | 'reasons' | 'thanks' | 'hidden'>('question');
  const [ratingId, setRatingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<UsefulnessReason[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const card = useRef<HTMLElement>(null);
  const viewed = useRef(false);
  const busy = useRef(false);
  const tokenGetter = useRef(getToken);
  tokenGetter.current = getToken;

  useEffect(() => {
    let alive = true;
    if (!shouldAskUsefulness(userId, analysisId)) return;
    void (async () => {
      try {
        const token = await tokenGetter.current();
        if (!token) return;
        const result = await getUsefulnessEligibility(analysisId, token);
        if (alive && result.eligible) setContext(result);
      } catch { /* No backend support/network: hide feedback, never block the analysis. */ }
    })();
    return () => { alive = false; };
  }, [analysisId, userId]);

  useEffect(() => {
    if (!context || !card.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (viewed.current || document.visibilityState !== 'visible' || !entries.some(e => e.isIntersecting && e.intersectionRatio >= 0.5)) return;
      viewed.current = true;
      markUsefulnessAsked(userId, analysisId);
      track('analysis_usefulness_viewed', { analysisId, modality: context.modality, verdict: context.verdict });
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [context, analysisId, userId]);

  if (!context || step === 'hidden') return null;
  const answer = async (useful: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setSending(true); setError(false);
    try {
      const token = await tokenGetter.current();
      if (!token) throw new Error('no_token');
      const saved = await rateUsefulness(analysisId, useful, token);
      markUsefulnessAnswered(userId, analysisId);
      setRatingId(saved.id);
      setStep(saved.duplicate || useful ? 'thanks' : 'reasons');
    } catch { setError(true); }
    finally { busy.current = false; setSending(false); }
  };
  const sendReasons = async () => {
    if (busy.current || !ratingId) return;
    if (!reasons.length) { setStep('thanks'); return; }
    busy.current = true; setSending(true); setError(false);
    try {
      const token = await tokenGetter.current();
      if (!token) throw new Error('no_token');
      await addUsefulnessReasons(ratingId, reasons, token);
      setStep('thanks');
    } catch { setError(true); }
    finally { busy.current = false; setSending(false); }
  };
  const labels: Array<[UsefulnessReason, string]> = [
    ['hard_to_understand', t.rating.reasonHard], ['next_step_unclear', t.rating.reasonNextStep],
    ['levels_or_asset', t.rating.reasonLevelsAsset], ['not_trusted', t.rating.reasonTrust],
    ['too_slow', t.rating.reasonSlow], ['other', t.rating.reasonOther],
  ];
  return <section ref={card} aria-label={t.rating.usefulnessQuestion} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
    {step === 'question' ? <div>
      <p className="text-sm font-semibold text-[var(--text-primary)]">{t.rating.usefulnessQuestion}</p>
      <p className="text-xs text-[var(--text-secondary)]">{t.rating.hint}</p>
      <div className="mt-3 flex gap-2">
        {[true, false].map(useful => <button key={String(useful)} type="button" disabled={sending} onClick={() => void answer(useful)}
          className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent-green)] disabled:opacity-60">{useful ? t.common.yes : t.common.no}</button>)}
      </div>
      <button type="button" disabled={sending} onClick={() => setStep('hidden')} className="mt-2 text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)]">{t.rating.notNow}</button>
    </div> : step === 'reasons' ? <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-[var(--text-primary)]">{t.rating.badTitle}</p>
      <p className="text-xs text-[var(--text-secondary)]">{t.rating.optionalReasons}</p>
      <div className="flex flex-wrap gap-2">{labels.map(([reason, label]) => <button key={reason} type="button" aria-pressed={reasons.includes(reason)} disabled={sending}
        onClick={() => setReasons(list => list.includes(reason) ? list.filter(r => r !== reason) : [...list, reason])}
        className={`rounded-full border px-3 py-1.5 text-xs ${reasons.includes(reason) ? 'border-[var(--accent-green)] text-[var(--text-primary)]' : 'border-[var(--border-default)] text-[var(--text-secondary)]'}`}>{label}</button>)}</div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={sending} onClick={() => void sendReasons()} className="rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] disabled:opacity-60">{t.rating.send}</button>
        <button type="button" disabled={sending} onClick={() => setStep('thanks')} className="text-xs text-[var(--text-secondary)] underline">{t.rating.skip}</button>
      </div>
    </div> : <div role="status"><p className="text-sm font-semibold text-[var(--text-primary)]">{t.rating.thanksTitle}</p><p className="text-xs text-[var(--text-secondary)]">{t.rating.thanksDesc}</p></div>}
    {error ? <p role="alert" className="mt-2 text-xs text-[var(--tone-down-2)]">{t.rating.error}</p> : null}
  </section>;
}

// Existing paid stars remain intact. Only suppress a persisted answer/cooldown, including after upgrade.
function PaidRatingGate({ analysisId }: { analysisId: string }) {
  const { getToken } = useAuth();
  const tokenGetter = useRef(getToken);
  tokenGetter.current = getToken;
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const token = await tokenGetter.current();
        if (!token) { if (alive) setAllowed(false); return; }
        const status = await getUsefulnessEligibility(analysisId, token);
        if (alive) setAllowed(status.modality === 'paid' && !status.answered && !status.recentAnswered);
      } catch { if (alive) setAllowed(true); /* Older backend keeps the functional paid flow. */ }
    })();
    return () => { alive = false; };
  }, [analysisId]);
  return allowed ? <StarRatingCard analysisId={analysisId} /> : null;
}

export default function RatingCard({ analysisId, usefulnessUserId, userId }: { analysisId: string; usefulnessUserId?: string; userId?: string }) {
  return usefulnessUserId ? <UsefulnessRatingCard analysisId={analysisId} userId={usefulnessUserId} />
    : userId ? <PaidRatingGate analysisId={analysisId} /> : <StarRatingCard analysisId={analysisId} />;
}
