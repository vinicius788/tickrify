import { useEffect, useState, type FormEvent } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { APIError, useAPIClient, type AnalysisQuestion } from '@/lib/api';
import type { SignalStateCanonical } from '@/lib/trading-ui';

const MIN_CHARS = 3;
const MAX_CHARS = 500;

type Notice = 'error' | 'tooShort' | 'noneAnalysis' | 'noneDay' | null;

/**
 * "Ask about this analysis" (25/11/2026): abaixo do resultado de uma analise
 * concluida da propria conta. A resposta EXPLICA a decisao gravada; o servidor
 * conta os limites e nada daqui muda a analise. Cada texto que muda fica num
 * <span> com `key` (Google Translate, CLAUDE.md 4.3).
 */
export default function AnalysisQuestions({ analysisId, signalState }: { analysisId: string; signalState: SignalStateCanonical }) {
  const { t } = useLanguage();
  const a = t.askAnalysis;
  const { listQuestions, askQuestion } = useAPIClient();
  const [items, setItems] = useState<AnalysisQuestion[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let alive = true;
    listQuestions(analysisId)
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setRemaining(data.remaining);
      })
      .catch(() => {
        // 402/404/indisponivel: a caixa nao aparece.
        if (alive) setHidden(true);
      });
    return () => {
      alive = false;
    };
  }, [analysisId, listQuestions]);

  if (hidden || remaining === null) return null;

  const suggestions = a.suggestions[signalState === 'ARMED' ? 'WATCH' : signalState];
  const out = remaining <= 0;

  const send = async (question: string, suggestion: boolean) => {
    const q = question.replace(/\s+/g, ' ').trim();
    if (sending || out) return;
    if (q.length < MIN_CHARS) {
      setNotice('tooShort');
      return;
    }
    track('analysis_question_clicked', { suggestion });
    setSending(true);
    setNotice(null);
    try {
      const res = await askQuestion(analysisId, q);
      setItems((prev) => [...prev, res.item]);
      setRemaining(res.remaining);
      setText('');
    } catch (error) {
      if (error instanceof APIError && error.code === 'question_limit') {
        setRemaining(0);
        setNotice(error.params?.scope === 'day' ? 'noneDay' : 'noneAnalysis');
      } else {
        setNotice('error');
      }
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(text, false);
  };

  const leftText = remaining === 1 ? a.leftOne : a.left.replace('{n}', String(remaining));
  const outText = notice === 'noneDay' ? a.noneDay : a.noneAnalysis;

  return (
    <section
      aria-label={a.title}
      data-testid="analysis-questions"
      translate="no"
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="tk-display text-base text-[var(--text-primary)]">{a.title}</h3>
        <p className="tk-meta tabular-nums text-xs text-[var(--text-secondary)]">
          <span key={out ? 'out' : `left-${remaining}`} data-testid="questions-left">{out ? '' : leftText}</span>
        </p>
      </div>

      {items.length > 0 && (
        <ol className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="space-y-1.5">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                <span>{item.question}</span>
              </p>
              <p className="whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)]">
                <span>{item.answer}</span>
              </p>
            </li>
          ))}
        </ol>
      )}

      {out ? (
        <p key="out-notice" role="status" className="mt-4 text-sm text-[var(--text-secondary)]">
          <span>{outText}</span>
        </p>
      ) : (
        <div key="ask-form" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={sending}
                onClick={() => void send(s, true)}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-1.5 text-left text-sm text-[var(--text-primary)] transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                <span>{s}</span>
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              type="text"
              value={text}
              maxLength={MAX_CHARS}
              onChange={(e) => setText(e.target.value)}
              placeholder={a.placeholder}
              aria-label={a.placeholder}
              disabled={sending}
              className="min-w-0 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending}
              className="shrink-0 rounded-xl bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <span key={sending ? 'sending' : 'send'}>{sending ? a.sending : a.send}</span>
            </button>
          </form>
        </div>
      )}

      {notice === 'error' || notice === 'tooShort' ? (
        <p key={`notice-${notice}`} role="alert" className="mt-2 text-sm text-[var(--signal-sell)]">
          <span>{notice === 'error' ? a.error : a.tooShort}</span>
        </p>
      ) : null}

      <p className="tk-meta mt-4 text-xs text-[var(--text-secondary)]">{a.disclaimer}</p>
    </section>
  );
}
