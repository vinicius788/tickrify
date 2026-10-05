import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { buildApiUrl } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/** Ate quando o quadrinho fica escondido (dispensado ou ja respondido). */
const HIDDEN_UNTIL_KEY = 'tickrify_feedback_hidden_until';
const DAY_MS = 24 * 60 * 60 * 1000;
const HIDE_AFTER_DISMISS_MS = 30 * DAY_MS;
const HIDE_AFTER_SEND_MS = 60 * DAY_MS;

function hiddenNow(): boolean {
  try {
    return Number(localStorage.getItem(HIDDEN_UNTIL_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

function hideFor(ms: number): void {
  try {
    localStorage.setItem(HIDDEN_UNTIL_KEY, String(Date.now() + ms));
  } catch {
    /* modo privado: o quadrinho so volta na proxima visita */
  }
}

/**
 * "O que voce esta achando da Tickrify?" (05/10/2026).
 *
 * O dono nao consegue responder e-mail de todo mundo; este quadrinho junta as
 * opinioes num lugar so: `POST /api/reports` com `kind: 'feedback'`, a mesma
 * tabela dos relatos de problema, lida na aba "Opinioes" do /admin. Opiniao
 * NAO dispara e-mail. So aparece para quem ja fez pelo menos uma analise (quem
 * nunca analisou ainda nao tem o que opinar) e some por 30 dias ao dispensar,
 * 60 depois de enviar.
 */
const FeedbackCard = () => {
  const { getToken } = useAuth();
  const { pathname } = useLocation();
  const { t } = useLanguage();
  const f = t.feedback;
  const [hidden, setHidden] = useState(hiddenNow);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (hidden) return null;

  if (state === 'sent') {
    return (
      <div role="status" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
        <p className="text-sm text-[var(--text-secondary)]">{f.thanks}</p>
      </div>
    );
  }

  const send = async () => {
    const message = text.trim();
    if (message.length < 5) {
      setError(f.short);
      return;
    }
    setState('sending');
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(buildApiUrl('/api/reports'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: message.slice(0, 2000), route: pathname, kind: 'feedback' }),
      });
      if (!res.ok) {
        setError(res.status === 429 ? f.limit : f.failed);
        setState('idle');
        return;
      }
      track('feedback_sent', { length: message.length, surface: 'card' });
      hideFor(HIDE_AFTER_SEND_MS);
      setState('sent');
    } catch {
      setError(f.failed);
      setState('idle');
    }
  };

  return (
    <section
      aria-labelledby="feedback-card-title"
      className="relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-4"
    >
      <button
        type="button"
        onClick={() => {
          track('feedback_dismissed');
          hideFor(HIDE_AFTER_DISMISS_MS);
          setHidden(true);
        }}
        aria-label={f.dismiss}
        className="absolute right-3 top-3 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" />
      </button>
      <h2 id="feedback-card-title" className="pr-8 text-sm font-semibold text-[var(--text-primary)]">
        {f.title}
      </h2>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{f.subtitle}</p>
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          rows={3}
          placeholder={f.placeholder}
          aria-label={f.title}
          className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-green)] md:text-sm"
        />
        {error && (
          <p role="alert" className="text-xs text-[var(--signal-sell)]">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={state === 'sending'}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#050508] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {state === 'sending' ? f.sending : f.send}
          </button>
        </div>
      </form>
    </section>
  );
};

export default FeedbackCard;
