import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { LOCALES } from '@/lib/i18n';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { APIError } from '@/lib/api';
import { CHAT_BODY_MAX, useChatActions, useChatMessages, type ChatThread } from '@/lib/support-chat';

/**
 * Conversa com o fundador, dentro da bolha "Chat, feedback or problem"
 * (12/10/2026). Honesta sobre presenca: nada de "online" nem bolinha verde,
 * so "costuma responder em algumas horas".
 *
 * Texto SEMPRE como texto (nunca HTML ou markdown). A lista e o campo levam
 * `data-sentry-mask`: o replay do Sentry ja mascara texto, isto e a segunda trava.
 */
const SupportChat = ({ thread }: { thread: ChatThread | null }) => {
  const { t, language } = useLanguage();
  const c = t.chat;
  const messages = useChatMessages(true);
  const { sendMessage, markRead } = useChatActions();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<'failed' | 'rateLimited' | 'unavailable' | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pages = messages.data?.pages ?? [];
  // A 1a pagina e a mais nova; as seguintes, cada vez mais antigas.
  const items = [...pages].reverse().flatMap((page) => page.items);
  const lastId = items[items.length - 1]?.id ?? null;
  const unread = thread?.unread ?? 0;

  // Leu o que esta na tela: zera o contador (uma vez por resposta nova).
  const markedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!lastId || unread === 0 || markedFor.current === lastId || document.visibilityState === 'hidden') return;
    markedFor.current = lastId;
    markRead.mutate();
  }, [lastId, unread, markRead]);

  // Mensagem nova (enviada ou recebida) leva a lista ao fim.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastId]);

  const submit = () => {
    const body = draft.trim();
    if (!body || sendMessage.isPending) return;
    setError(null);
    track('chat_message_submitted', { length: body.length });
    sendMessage.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: (err) => {
        if (err instanceof APIError && err.status === 429) setError('rateLimited');
        else if (err instanceof APIError && err.status === 503) setError('unavailable');
        else setError('failed');
      },
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envia; Shift+Enter quebra linha; teclado de idioma compondo (IME) nunca envia.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const time = (iso: string) =>
    new Date(iso).toLocaleString(LOCALES[language], { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{c.title}</h2>
        <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">{c.subtitle}</p>
      </div>

      <div
        ref={listRef}
        data-sentry-mask
        aria-live="polite"
        className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--bg-inset)] p-2.5"
      >
        {messages.hasNextPage ? (
          <button
            type="button"
            onClick={() => void messages.fetchNextPage()}
            disabled={messages.isFetchingNextPage}
            className="self-center text-[11px] text-[var(--text-faint)] underline-offset-2 hover:text-[var(--text-soft)] hover:underline"
          >
            {c.loadEarlier}
          </button>
        ) : null}
        {items.length === 0 && !messages.isLoading ? (
          <div key="welcome" className="max-w-[85%] self-start rounded-lg bg-[var(--fill-3)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{c.founder}</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">{c.welcome}</p>
          </div>
        ) : null}
        {items.map((message) => {
          const mine = message.author === 'user';
          return (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-lg px-3 py-2 ${mine ? 'self-end bg-[var(--fill-6)]' : 'self-start bg-[var(--fill-3)]'}`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                {`${mine ? c.you : c.founder} · ${time(message.createdAt)}`}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">{message.body}</p>
            </div>
          );
        })}
      </div>

      {error ? (
        <p key={error} role="alert" className="mt-2 text-[11px] text-[var(--tone-down-1)]">
          {c[error]}
        </p>
      ) : null}

      <textarea
        data-sentry-mask
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={CHAT_BODY_MAX}
        rows={2}
        enterKeyHint="send"
        aria-label={c.placeholder}
        placeholder={c.placeholder}
        className="mt-2 w-full resize-none rounded-lg border border-[var(--border-strong)] bg-[var(--bg-inset)] p-2.5 text-base text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:border-[var(--border-heavy)] focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="hidden text-[11px] text-[var(--text-ghost)] sm:block">{c.hint}</p>
        <Button size="sm" className="ml-auto" onClick={submit} disabled={sendMessage.isPending || !draft.trim()}>
          {sendMessage.isPending ? c.sending : c.send}
        </Button>
      </div>
    </div>
  );
};

export default SupportChat;
