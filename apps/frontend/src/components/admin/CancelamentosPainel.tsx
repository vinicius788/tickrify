import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { buildApiUrl } from '@/lib/api';

type Cancelamento = {
  subscriptionId: string;
  email: string | null;
  status: string;
  billingCycle: 'weekly' | 'monthly' | 'yearly' | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  accessEndsAt: string | null;
  createdAt: string;
  cancelReason: string | null;
  cancelFeedback: string | null;
  affiliateCode: string | null;
};

/** As opcoes fixas do portal da Stripe (configuracao `portal_v1`). */
const MOTIVO: Record<string, string> = {
  too_expensive: 'Caro demais',
  missing_features: 'Falta recurso',
  switched_service: 'Trocou de serviço',
  unused: 'Não usava',
  low_quality: 'Qualidade baixa',
  too_complex: 'Complicado demais',
  customer_service: 'Atendimento',
  other: 'Outro',
};

const CICLO: Record<string, string> = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };

function data(valor: string | null): string {
  return valor ? new Date(valor).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '·';
}

/** Dias entre assinar e cancelar (1 = no mesmo dia). */
function diaDoCancelamento(c: Cancelamento): string {
  if (!c.canceledAt) return '·';
  const dias = Math.floor((new Date(c.canceledAt).getTime() - new Date(c.createdAt).getTime()) / 86_400_000) + 1;
  return dias > 0 ? `dia ${dias}` : '·';
}

/**
 * Aba "Cancelamentos" (13/10/2026): quem cancelou pelo portal da Stripe, com
 * o motivo escolhido (lista fechada), o plano, quando o acesso termina e o
 * codigo do afiliado que indicou. So leitura. Ver `GET admin/cancellations`.
 */
export default function CancelamentosPainel() {
  const { getToken, isSignedIn } = useAuth();
  const query = useQuery<Cancelamento[], Error>({
    queryKey: ['admin-cancellations'],
    enabled: Boolean(isSignedIn),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const token = await getToken({ skipCache: true });
      const res = await fetch(buildApiUrl('/api/admin/cancellations'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Falha ao carregar (${res.status})`);
      return res.json();
    },
  });
  const linhas = query.data ?? [];
  const porMotivo = linhas.reduce<Record<string, number>>((acc, c) => {
    const chave = c.cancelFeedback ?? 'sem_motivo';
    acc[chave] = (acc[chave] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="mt-10 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Cancelamentos</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">
          Agendados (acesso até o fim do período pago) e encerrados. Motivo = o que a pessoa escolheu no portal da Stripe.
        </p>
      </div>

      {query.isLoading ? <p className="text-sm text-[var(--text-faint)]">Carregando…</p> : null}
      {query.error ? <p className="text-sm text-[var(--tone-down-2)]">{query.error.message}</p> : null}

      {linhas.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {Object.entries(porMotivo)
            .sort((a, b) => b[1] - a[1])
            .map(([motivo, n]) => (
              <span key={motivo} className="rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs text-[var(--text-soft)]">
                {MOTIVO[motivo] ?? 'Sem motivo'}: {n}
              </span>
            ))}
        </div>
      ) : null}

      <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
        {!query.isLoading && linhas.length === 0 ? (
          <p className="text-sm text-[var(--text-faint)]">Nenhum cancelamento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--text-faint)]">
                <tr>
                  <th className="py-1 pr-3">Pessoa</th>
                  <th className="py-1 pr-3">Plano</th>
                  <th className="py-1 pr-3">Cancelou em</th>
                  <th className="py-1 pr-3">Acesso até</th>
                  <th className="py-1 pr-3">Situação</th>
                  <th className="py-1 pr-3">Motivo</th>
                  <th className="py-1">Afiliado</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((c) => (
                  <tr key={c.subscriptionId} className="border-t border-[var(--border-subtle)] text-[var(--text-soft)]">
                    <td className="py-1.5 pr-3">{c.email ?? 'sem e-mail'}</td>
                    <td className="py-1.5 pr-3">{c.billingCycle ? CICLO[c.billingCycle] : '·'}</td>
                    <td className="py-1.5 pr-3">
                      {data(c.canceledAt)} <span className="text-[var(--text-faint)]">({diaDoCancelamento(c)})</span>
                    </td>
                    <td className="py-1.5 pr-3">{data(c.accessEndsAt)}</td>
                    <td className="py-1.5 pr-3">{c.status === 'canceled' ? 'encerrada' : 'agendada'}</td>
                    <td className="py-1.5 pr-3">{c.cancelFeedback ? MOTIVO[c.cancelFeedback] ?? c.cancelFeedback : '·'}</td>
                    <td className="py-1.5 font-terminal">{c.affiliateCode ?? '·'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
