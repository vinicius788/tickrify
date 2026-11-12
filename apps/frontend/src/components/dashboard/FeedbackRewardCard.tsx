import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useQueryClient } from '@tanstack/react-query';
import { Gift } from 'lucide-react';
import { buildApiUrl } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { refreshUsage } from '@/hooks/useAnalysisLimit';
import { useToast } from '@/hooks/use-toast';

/** Os mesmos limites do servidor (common/feedback-bonus.ts), so para avisar antes de enviar. */
const MIN_LENGTH = 15;
const MAX_LENGTH = 500;

export type FeedbackRewardSource = 'home' | 'result' | 'limit';

/**
 * Opiniao que vale 3 analises (11/11/2026). Conta sem assinatura escreve uma
 * frase sobre a plataforma e o servidor credita as analises, uma vez por conta
 * (`POST /api/feedback`; a regra inteira mora la). Quem decide se o card
 * aparece e o `/usage` (`feedbackReward.available`). Discreto no inicio e
 * abaixo do resultado; com destaque (`prominent`) na tela de limite, acima do
 * paywall. O texto nunca vai ao PostHog.
 */
const FeedbackRewardCard = ({ source, prominent = false }: { source: FeedbackRewardSource; prominent?: boolean }) => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const f = t.feedbackReward;
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    track('feedback_prompt_shown', { source });
  }, [source]);

  const length = text.trim().replace(/\s+/g, ' ').length;

  const send = async () => {
    if (length < MIN_LENGTH) {
      setError(f.short);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(buildApiUrl('/api/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: text.trim(), source }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        const messages: Record<string, string> = {
          feedback_invalid: f.short,
          feedback_already_used: f.used,
          feedback_subscriber: f.unavailable,
          feedback_not_eligible: f.unavailable,
        };
        setError(messages[String(body.code)] ?? f.failed);
        setSending(false);
        // Ja usada ou sem direito: o /usage relido tira o card da tela.
        if (res.status === 409 || res.status === 403) refreshUsage();
        return;
      }
      // O card sai da tela quando o /usage volta: o agradecimento vai no aviso.
      toast({ title: f.thanks });
      // Cota, trava do historico e paywall mudam juntos com o credito.
      refreshUsage();
      void queryClient.invalidateQueries();
    } catch {
      setError(f.failed);
      setSending(false);
    }
  };

  return (
    <section
      aria-labelledby={`feedback-reward-${source}`}
      className={`rounded-xl border bg-[var(--bg-card)] px-4 py-4 ${prominent ? 'border-[var(--signal-buy)] md:px-6 md:py-5' : 'border-[var(--border-subtle)]'}`}
    >
      {prominent ? <p className="tk-eyebrow mb-1">{f.limitLead}</p> : null}
      <h2 id={`feedback-reward-${source}`} className={`flex items-center gap-2 font-semibold text-[var(--text-primary)] ${prominent ? 'text-lg' : 'text-sm'}`}>
        <Gift className="h-4 w-4 shrink-0 text-[var(--signal-buy)]" aria-hidden />
        <span>{f.title}</span>
      </h2>
      <p className={`mt-1 text-[var(--text-secondary)] ${prominent ? 'text-sm' : 'text-xs'}`}>{f.subtitle}</p>
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
          maxLength={MAX_LENGTH}
          rows={prominent ? 3 : 2}
          placeholder={f.placeholder}
          aria-label={f.title}
          className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-green)] md:text-sm"
        />
        {error ? (
          <p key="error" role="alert" className="text-xs text-[var(--signal-sell)]">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="tk-meta tabular-nums text-xs">{f.counter.replace('{n}', String(length))}</span>
          <button
            type="submit"
            disabled={sending}
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 ${prominent ? 'bg-[var(--signal-buy)] text-[var(--on-accent)]' : 'bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'}`}
          >
            {sending ? f.sending : f.send}
          </button>
        </div>
      </form>
    </section>
  );
};

export default FeedbackRewardCard;
