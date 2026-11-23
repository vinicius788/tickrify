import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { APIError } from '@/lib/api';
import { founderMessageSeen, useAdminChatActions, useAdminChatThread, useAdminChatThreads, type AdminChatThread } from '@/lib/support-chat';

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca');

const PLANO: Record<string, string> = { free: 'grátis', manual: 'acesso manual', weekly: 'semanal', monthly: 'mensal', yearly: 'anual', paid: 'assinante' };

/** Enter envia, Shift+Enter quebra linha (igual ao chat do usuario). */
function enviarNoEnter(event: KeyboardEvent<HTMLTextAreaElement>, enviar: () => void) {
  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault();
    enviar();
  }
}

function Conversa({ thread }: { thread: AdminChatThread }) {
  const { toast } = useToast();
  const { data, isLoading } = useAdminChatThread(thread.id);
  const { reply, setStatus } = useAdminChatActions();
  const [texto, setTexto] = useState('');

  const responder = () => {
    const body = texto.trim();
    if (!body || reply.isPending) return;
    reply.mutate(
      { threadId: thread.id, body },
      {
        onSuccess: () => setTexto(''),
        onError: (e) => toast({ title: 'Não enviou', description: e.message, variant: 'destructive' }),
      },
    );
  };
  const fechada = (data?.thread.status ?? thread.status) === 'closed';
  const lidaEm = data?.thread.userReadAt ?? thread.userReadAt;

  return (
    <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{thread.email ?? 'sem e-mail'}</h3>
          <p className="text-xs text-[var(--text-faint)]">
            {`${PLANO[thread.plan] ?? thread.plan} · origem: ${thread.acquisitionSource ?? 'não respondeu'} · última análise: ${quando(thread.lastAnalysisAt)}`}
          </p>
          <p className="text-xs text-[var(--text-faint)]">{`abriu o chat por último: ${quando(lidaEm)}`}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={setStatus.isPending}
          onClick={() => setStatus.mutate({ threadId: thread.id, status: fechada ? 'open' : 'closed' })}
        >
          {fechada ? 'Reabrir' : 'Marcar como fechada'}
        </Button>
      </div>

      <div className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--bg-inset)] p-2.5">
        {isLoading ? <p className="text-xs text-[var(--text-faint)]">Carregando…</p> : null}
        {(data?.items ?? []).map((m) => {
          const doFundador = m.author === 'founder';
          const visto = doFundador ? (founderMessageSeen(m.createdAt, lidaEm) ? ' · Visto' : ' · Não visto') : '';
          return (
            <div key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 ${doFundador ? 'self-end bg-[var(--fill-6)]' : 'self-start bg-[var(--fill-3)]'}`}>
              <p className="text-xs font-medium text-[var(--text-faint)]">{`${doFundador ? 'Você' : 'Usuário'} · ${quando(m.createdAt)}${visto}`}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">{m.body}</p>
            </div>
          );
        })}
      </div>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => enviarNoEnter(e, responder)}
        maxLength={2000}
        rows={3}
        placeholder="Responder (Enter envia, Shift+Enter quebra linha)"
        className="mt-3 w-full resize-none rounded-lg border border-[var(--border-strong)] bg-[var(--bg-inset)] p-2.5 text-base text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:border-[var(--border-heavy)] focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={responder} disabled={reply.isPending || !texto.trim()}>
          {reply.isPending ? 'Enviando…' : 'Responder'}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Aba Chat do /admin (12/10/2026): conversas com mensagem nova primeiro, a
 * conversa aberta com resposta, e "Iniciar conversa" pelo e-mail (ex.: falar
 * com um assinante que parou de usar). A pessoa le a resposta no painel dela;
 * o aviso por e-mail depende da chave CHAT_EMAIL_NOTIFY.
 */
export default function ChatPainel() {
  const { toast } = useToast();
  const { data, isLoading, error } = useAdminChatThreads(false);
  const { start } = useAdminChatActions();
  const [aberta, setAberta] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [mensagem, setMensagem] = useState('');
  const itens = data?.items ?? [];
  const selecionada = itens.find((t) => t.id === aberta) ?? null;

  const iniciar = () => {
    if (!email.trim() || !mensagem.trim() || start.isPending) return;
    start.mutate(
      { email: email.trim(), body: mensagem.trim() },
      {
        onSuccess: (res) => {
          setEmail('');
          setMensagem('');
          setAberta(res.threadId);
          toast({ title: 'Mensagem enviada', description: 'A pessoa vê no painel dela.' });
        },
        onError: (e) =>
          toast({
            title: 'Não enviou',
            description: e instanceof APIError && e.status === 404 ? 'Nenhuma conta com esse e-mail.' : e.message,
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Iniciar conversa</h3>
        <p className="mt-1 text-xs text-[var(--text-faint)]">Pelo e-mail da conta. Se a pessoa já tem conversa, a mensagem entra nela.</p>
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e-mail da conta"
            className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-inset)] px-2.5 py-2 text-base text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:border-[var(--border-heavy)] focus:outline-none"
          />
          <textarea
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Mensagem (em inglês, assinada como Vinícius)"
            className="resize-none rounded-lg border border-[var(--border-strong)] bg-[var(--bg-inset)] p-2.5 text-base text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:border-[var(--border-heavy)] focus:outline-none"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={iniciar} disabled={start.isPending || !email.trim() || !mensagem.trim()}>
              {start.isPending ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </div>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Conversas</h3>
        {isLoading ? <p className="text-sm text-[var(--text-faint)]">Carregando…</p> : null}
        {error ? <p className="text-sm text-[var(--tone-down-2)]">{`Não deu para carregar: ${error.message}`}</p> : null}
        {!isLoading && !error && itens.length === 0 ? <p className="text-sm text-[var(--text-faint)]">Nenhuma conversa ainda.</p> : null}
        <ul className="flex flex-col gap-2">
          {itens.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setAberta(t.id === aberta ? null : t.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  t.id === aberta ? 'border-[var(--border-heavy)] bg-[var(--fill-3)]' : 'border-[var(--border-strong)] bg-[var(--fill-1)] hover:bg-[var(--fill-2)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-[var(--text-primary)]">{t.email ?? 'sem e-mail'}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--text-faint)]">
                    <span>{quando(t.lastMessageAt)}</span>
                    {t.unread > 0 ? (
                      <span key="nova" className="rounded-full border border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] px-2 text-[var(--signal-hold)]">{`${t.unread} nova(s)`}</span>
                    ) : null}
                    {t.lastAuthor === 'founder' && t.lastMessageAt && !founderMessageSeen(t.lastMessageAt, t.userReadAt) ? (
                      <span key="nao-visto">não viu</span>
                    ) : null}
                    {t.status === 'closed' ? <span key="fechada">fechada</span> : null}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--text-dim)]">
                  {`${t.isSubscriber ? 'assinante' : 'grátis'} · ${t.lastAuthor === 'founder' ? 'Você: ' : ''}${t.lastMessage ?? ''}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selecionada ? <Conversa key={selecionada.id} thread={selecionada} /> : null}
    </div>
  );
}
