import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { useSaveWatchAssets, useWatchAssetAlert, type WatchAssets } from '@/lib/setups';

/**
 * Quiz de conta nova (11/11/2026): tres perguntas de um toque no lugar do
 * seletor vazio do My assets. As respostas montam o painel com o que ja existe
 * (lista de ativos, tempo grafico e alerta nos niveis do dia). Nada vai ao
 * motor. Aparece uma vez por aparelho e some depois da primeira analise.
 */
export type QuizPain = 'late' | 'stop' | 'over' | 'miss';
type QuizState = { done: boolean; pain: QuizPain | null; alertsOn: boolean };

const STORAGE_KEY = 'tickrify_onboarding_quiz';
const PAINS: readonly QuizPain[] = ['late', 'stop', 'over', 'miss'];
const QUIZ_TIMEFRAMES = ['5m', '15m', '1h', '4h'] as const;
const OTHER = '__other__';

export function readQuizState(): QuizState {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<QuizState> | null;
    if (!raw || raw.done !== true) return { done: false, pain: null, alertsOn: false };
    return { done: true, pain: PAINS.includes(raw.pain as QuizPain) ? (raw.pain as QuizPain) : null, alertsOn: raw.alertsOn === true };
  } catch {
    return { done: false, pain: null, alertsOn: false };
  }
}

function writeQuizState(state: QuizState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* sem armazenamento: o quiz so volta a aparecer neste aparelho */
  }
}

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

const OnboardingQuiz = ({ data, onDone }: { data: WatchAssets; onDone: () => void }) => {
  const { t } = useLanguage();
  const q = t.quiz;
  const save = useSaveWatchAssets();
  const alert = useWatchAssetAlert();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<string | null>(null);
  const [pain, setPain] = useState<QuizPain | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    track('onboarding_quiz_viewed', {});
  }, []);

  const symbols = picked.filter((symbol) => symbol !== OTHER);
  const toggle = (symbol: string) =>
    setPicked((current) => {
      if (current.includes(symbol)) return current.filter((s) => s !== symbol);
      if (symbol !== OTHER && current.filter((s) => s !== OTHER).length >= data.maxAssets) return current;
      return [...current, symbol];
    });

  const skip = () => {
    track('onboarding_quiz_skipped', { step });
    writeQuizState({ done: true, pain: null, alertsOn: false });
    onDone();
  };

  const finish = async () => {
    if (!pain || busy) return;
    setBusy(true);
    setFailed(false);
    const tf = timeframe && data.timeframes.includes(timeframe) ? timeframe : data.timeframe;
    let alertsOn = false;
    try {
      if (symbols.length > 0) {
        const saved = await save.mutateAsync({ symbols, timeframe: tf });
        // Quem perde o movimento por estar longe ja sai com o alerta ligado.
        if (pain === 'miss' && saved.alertsAvailable === true) {
          const results = await Promise.allSettled(symbols.map((symbol) => alert.mutateAsync({ symbol, on: true })));
          alertsOn = results.some((result) => result.status === 'fulfilled');
        }
      }
    } catch {
      setBusy(false);
      setFailed(true);
      return;
    }
    track('onboarding_quiz_completed', { assets: symbols.length, other: picked.includes(OTHER), timeframe: tf, pain, alerts_on: alertsOn });
    writeQuizState({ done: true, pain, alertsOn });
    onDone();
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
      active
        ? 'border-transparent bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
        : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]'
    }`;
  const option = (active: boolean) =>
    `flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors ${
      active ? 'border-[var(--text-primary)] bg-[var(--fill-2)]' : 'border-[var(--border-subtle)] hover:bg-[var(--fill-2)]'
    }`;
  const primary = 'rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-50';
  const link = 'text-sm text-[var(--text-tertiary)] underline underline-offset-4 hover:text-[var(--text-primary)]';

  const timeframes: Array<{ value: string; title: string; sub: string }> = [
    { value: '5m', title: q.tf5, sub: q.tf5Sub },
    { value: '15m', title: q.tf15, sub: q.tf15Sub },
    { value: '1h', title: q.tf1h, sub: q.tf1hSub },
    { value: '4h', title: q.tf4h, sub: q.tf4hSub },
  ].filter((item) => (QUIZ_TIMEFRAMES as readonly string[]).includes(item.value) && data.timeframes.includes(item.value));
  const pains: Array<{ value: QuizPain; title: string; sub: string }> = [
    { value: 'late', title: q.painLate, sub: q.painLateSub },
    { value: 'stop', title: q.painStop, sub: q.painStopSub },
    { value: 'over', title: q.painOver, sub: q.painOverSub },
    { value: 'miss', title: q.painMiss, sub: q.painMissSub },
  ];

  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5" aria-labelledby="onboarding-quiz-title">
      <div className="mb-4 h-[3px] overflow-hidden rounded-full bg-[var(--fill-3)]" aria-hidden="true">
        <div className="h-full bg-[var(--text-primary)] transition-[width] motion-reduce:transition-none" style={{ width: `${(step * 100) / 3}%` }} />
      </div>
      <p className="tk-meta mb-1 tabular-nums">{fill(q.step, { n: step })}</p>

      {step === 1 ? (
        <div key="q1">
          <h2 id="onboarding-quiz-title" className="mb-1 text-lg font-semibold text-[var(--text-primary)]">{q.q1Title}</h2>
          <p className="mb-4 text-sm text-[var(--text-secondary)]">{fill(q.q1Sub, { max: data.maxAssets })}</p>
          <div className="mb-5 flex flex-wrap gap-2">
            {[...data.suggested, OTHER].map((symbol) => (
              <button key={symbol} type="button" aria-pressed={picked.includes(symbol)} onClick={() => toggle(symbol)} className={chip(picked.includes(symbol))}>
                {symbol === OTHER ? q.other : symbol}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={skip} className={link}>{q.skip}</button>
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => {
                track('onboarding_quiz_answered', { step: 1, assets: symbols.length, other: picked.includes(OTHER) });
                setStep(2);
              }}
              className={primary}
            >
              {q.next}
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div key="q2">
          <h2 id="onboarding-quiz-title" className="mb-4 text-lg font-semibold text-[var(--text-primary)]">{q.q2Title}</h2>
          <div role="radiogroup" aria-labelledby="onboarding-quiz-title" className="mb-5 grid gap-2 sm:grid-cols-2">
            {timeframes.map((item) => (
              <button key={item.value} type="button" role="radio" aria-checked={timeframe === item.value} onClick={() => setTimeframe(item.value)} className={option(timeframe === item.value)}>
                <span className="text-sm font-medium text-[var(--text-primary)]">{item.title}</span>
                <span className="tk-meta">{item.sub}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-4">
              <button type="button" onClick={() => setStep(1)} className={link}>{q.back}</button>
              <button type="button" onClick={skip} className={link}>{q.skip}</button>
            </div>
            <button
              type="button"
              disabled={!timeframe}
              onClick={() => {
                track('onboarding_quiz_answered', { step: 2, timeframe });
                setStep(3);
              }}
              className={primary}
            >
              {q.next}
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div key="q3">
          <h2 id="onboarding-quiz-title" className="mb-1 text-lg font-semibold text-[var(--text-primary)]">{q.q3Title}</h2>
          <p className="mb-4 text-sm text-[var(--text-secondary)]">{q.q3Sub}</p>
          <div role="radiogroup" aria-labelledby="onboarding-quiz-title" className="mb-5 grid gap-2 sm:grid-cols-2">
            {pains.map((item) => (
              <button key={item.value} type="button" role="radio" aria-checked={pain === item.value} onClick={() => setPain(item.value)} className={option(pain === item.value)}>
                <span className="text-sm font-medium text-[var(--text-primary)]">{item.title}</span>
                <span className="tk-meta">{item.sub}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-4">
              <button type="button" onClick={() => setStep(2)} className={link}>{q.back}</button>
              <button type="button" onClick={skip} className={link}>{q.skip}</button>
            </div>
            <button type="button" disabled={!pain || busy} onClick={finish} className={primary}>
              <span key={busy ? 'saving' : 'finish'}>{busy ? q.saving : q.finish}</span>
            </button>
          </div>
          {failed ? <p role="status" className="mt-3 text-sm" style={{ color: 'var(--signal-sell)' }}>{q.failed}</p> : null}
        </div>
      ) : null}
    </section>
  );
};

export default OnboardingQuiz;
