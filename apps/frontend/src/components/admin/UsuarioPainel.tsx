import { useState } from 'react';
import { Chip, Estado, Painel, Tabela, dataHora, useAdminQuery } from '@/components/admin/AdminUi';

type Hit = { id: string; email: string | null; name: string | null; role: string; createdAt: string };
type Ficha = {
  user: Hit & { plan: string; subscriptionStatus: string | null };
  subscriptions: Array<{ stripeId: string; status: string; priceId: string | null; currentPeriodEnd: string | null; createdAt: string }>;
  trial: { status: string; startedAt: string; endedAt: string | null; endReason: string | null; source: string } | null;
  analyses: { total: number; last7d: number; recent: Array<{ id: string; createdAt: string; status: string; symbol: string | null; signalState: string | null; action: string | null }> };
  setups: Array<{ id: string; symbol: string | null; timeframe: string | null; status: string; lastAnalysisAt: string }>;
  alerts: { byStatus: Record<string, number>; recent: Array<{ id: string; symbol: string; level: number; label: string; status: string; createdAt: string; triggeredAt: string | null }> };
  chat: { threadId: string; status: string; lastMessageAt: string | null; messages: number } | null;
};

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-t border-[var(--border-subtle)] py-1.5 text-sm first:border-t-0">
      <dt className="text-[var(--text-dim)]">{rotulo}</dt>
      <dd className="text-right text-[var(--text-primary)]">{valor ?? '-'}</dd>
    </div>
  );
}

function FichaUsuario({ id, onAnalise, onChat }: { id: string; onAnalise: (id: string) => void; onChat: () => void }) {
  const query = useAdminQuery<Ficha>(`users/${encodeURIComponent(id)}`, 30_000);
  const f = query.data;
  const viva = f?.subscriptions.find((s) => s.status === 'active');
  const alertas = f ? Object.entries(f.alerts.byStatus).map(([s, n]) => `${s}: ${n}`).join(' · ') : '';

  return (
    <div className="space-y-4">
      <Estado query={query} />
      {f ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Painel titulo={f.user.email ?? f.user.id} nota={`Cadastro em ${dataHora(f.user.createdAt)}`}>
            <dl>
              <Campo rotulo="Papel" valor={f.user.role} />
              <Campo rotulo="Plano (coluna do usuário)" valor={`${f.user.plan}${f.user.subscriptionStatus ? ` · ${f.user.subscriptionStatus}` : ''}`} />
              <Campo rotulo="Assinatura ativa" valor={viva ? <Chip tom={viva.stripeId.startsWith('manual_') ? 'neutro' : 'ok'}>{viva.stripeId.startsWith('manual_') ? 'acesso manual' : 'paga'}</Chip> : 'nenhuma'} />
              <Campo rotulo="Trial" valor={f.trial ? `${f.trial.status}${f.trial.endReason ? ` (${f.trial.endReason})` : ''} · desde ${dataHora(f.trial.startedAt)}` : 'sem trial'} />
              <Campo rotulo="Análises" valor={`${f.analyses.total} no total · ${f.analyses.last7d} em 7 dias`} />
              <Campo rotulo="Alertas" valor={alertas || 'nenhum'} />
            </dl>
            {f.subscriptions.length ? (
              <div className="mt-3">
                <Tabela colunas={[{ rotulo: 'Assinatura' }, { rotulo: 'Status' }, { rotulo: 'Até' }]}>
                  {f.subscriptions.map((s) => (
                    <tr key={s.stripeId} className="border-t border-[var(--border-subtle)]">
                      <td className="py-1.5 pr-3 font-mono text-xs">{s.stripeId}</td>
                      <td className="py-1.5 pr-3">{s.status}</td>
                      <td className="py-1.5">{dataHora(s.currentPeriodEnd)}</td>
                    </tr>
                  ))}
                </Tabela>
              </div>
            ) : null}
          </Painel>

          <Painel titulo="Chat" nota="A conversa em si fica na aba Chat.">
            {f.chat ? (
              <>
                <dl>
                  <Campo rotulo="Conversa" valor={f.chat.status} />
                  <Campo rotulo="Mensagens" valor={f.chat.messages} />
                  <Campo rotulo="Última mensagem" valor={dataHora(f.chat.lastMessageAt)} />
                </dl>
                <button type="button" className="mt-3 text-sm text-[var(--text-primary)] underline underline-offset-2" onClick={onChat}>
                  Abrir a aba Chat
                </button>
              </>
            ) : (
              <p className="text-sm text-[var(--text-faint)]">Nunca abriu o chat.</p>
            )}
          </Painel>

          <Painel titulo="Setups acompanhados">
            {f.setups.length ? (
              <Tabela colunas={[{ rotulo: 'Ativo' }, { rotulo: 'Status' }, { rotulo: 'Última' }]}>
                {f.setups.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--border-subtle)]">
                    <td className="py-1.5 pr-3">{`${s.symbol ?? '-'} ${s.timeframe ?? ''}`}</td>
                    <td className="py-1.5 pr-3">{s.status}</td>
                    <td className="py-1.5">{dataHora(s.lastAnalysisAt)}</td>
                  </tr>
                ))}
              </Tabela>
            ) : (
              <p className="text-sm text-[var(--text-faint)]">Nenhum.</p>
            )}
          </Painel>

          <Painel titulo="Análises recentes" className="xl:col-span-2">
            {f.analyses.recent.length ? (
              <Tabela colunas={[{ rotulo: 'Quando' }, { rotulo: 'Ativo' }, { rotulo: 'Estado' }, { rotulo: 'Entrada' }, { rotulo: '' }]}>
                {f.analyses.recent.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--border-subtle)]">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{dataHora(a.createdAt)}</td>
                    <td className="py-1.5 pr-3">{a.symbol ?? '-'}</td>
                    <td className="py-1.5 pr-3">{a.status === 'completed' ? a.signalState ?? '-' : a.status}</td>
                    <td className="py-1.5 pr-3">{a.action ?? '-'}</td>
                    <td className="py-1.5">
                      <button type="button" className="text-[var(--text-primary)] underline underline-offset-2" onClick={() => onAnalise(a.id)}>
                        inspecionar
                      </button>
                    </td>
                  </tr>
                ))}
              </Tabela>
            ) : (
              <p className="text-sm text-[var(--text-faint)]">Nenhuma análise.</p>
            )}
          </Painel>

          <Painel titulo="Alertas recentes">
            {f.alerts.recent.length ? (
              <Tabela colunas={[{ rotulo: 'Ativo' }, { rotulo: 'Nível' }, { rotulo: 'Status' }]}>
                {f.alerts.recent.map((a) => (
                  <tr key={a.id} className="border-t border-[var(--border-subtle)]">
                    <td className="py-1.5 pr-3">{a.symbol}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{`${a.level} (${a.label})`}</td>
                    <td className="py-1.5">{a.status}</td>
                  </tr>
                ))}
              </Tabela>
            ) : (
              <p className="text-sm text-[var(--text-faint)]">Nenhum.</p>
            )}
          </Painel>
        </div>
      ) : null}
    </div>
  );
}

/** Aba "Usuário": busca por e-mail e ficha da pessoa. So leitura. */
export default function UsuarioPainel({ usuarioInicial, onAnalise, onChat }: { usuarioInicial: string | null; onAnalise: (id: string) => void; onChat: () => void }) {
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(usuarioInicial);
  const termo = busca.trim();
  const lista = useAdminQuery<{ items: Hit[] }>(termo.length >= 2 ? `users?q=${encodeURIComponent(termo)}` : null);

  return (
    <section className="space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setBusca(texto);
          setAberto(null);
        }}
      >
        <input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="E-mail da pessoa (ou parte dele)"
          aria-label="Buscar usuário"
          className="min-w-0 flex-1 rounded border border-[var(--border-strong)] bg-[var(--bg-inset)] px-3 py-2 text-base text-[var(--text-primary)]"
        />
        <button type="submit" className="rounded border border-[var(--border-strong)] bg-[var(--fill-2)] px-4 py-2 text-sm text-[var(--text-primary)]">
          Buscar
        </button>
      </form>

      {termo.length >= 2 ? (
        <Painel titulo="Resultados">
          <Estado query={lista} />
          {lista.data && lista.data.items.length === 0 ? <p className="text-sm text-[var(--text-faint)]">Ninguém com esse e-mail.</p> : null}
          {lista.data && lista.data.items.length > 0 ? (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {lista.data.items.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate text-[var(--text-soft)]">{`${u.email ?? u.id}${u.role === 'admin' ? ' (admin)' : ''}`}</span>
                  <button type="button" className="shrink-0 text-[var(--text-primary)] underline underline-offset-2" onClick={() => setAberto(u.id)}>
                    abrir
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Painel>
      ) : null}

      {aberto ? <FichaUsuario key={aberto} id={aberto} onAnalise={onAnalise} onChat={onChat} /> : null}
    </section>
  );
}
