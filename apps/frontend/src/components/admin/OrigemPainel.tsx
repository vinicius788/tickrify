import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { buildApiUrl } from '@/lib/api';

type Linha = { canal: string; cadastros: number; analisaram: number; assinaram: number; ativos: number };
type Resposta = { respondidoEm: string | null; canal: string; detalhe: string | null; email: string | null; assinou: boolean };
type Relatorio = { dias: number | null; declarada: Linha[]; tecnica: Linha[]; respostas: Resposta[] };

const PERIODOS: Array<{ dias: number; rotulo: string }> = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
  { dias: 0, rotulo: 'desde o início' },
];

/** As opções da pergunta "How did you find Tickrify?" (AcquisitionSurvey). */
const NOME_CANAL: Record<string, string> = {
  chatgpt: 'ChatGPT',
  other_ai: 'Outra IA (Gemini, Perplexity, Claude)',
  google: 'Busca no Google',
  social: 'Instagram, TikTok ou YouTube',
  community: 'Reddit, Discord ou fórum',
  friend: 'Indicação',
  ad: 'Anúncio',
  other: 'Outro',
};

function pct(parte: number, todo: number): string {
  return todo > 0 ? `${Math.round((parte / todo) * 100)}%` : '·';
}

function Tabela({ titulo, nota, linhas, nomear }: { titulo: string; nota: string; linhas: Linha[]; nomear?: boolean }) {
  return (
    <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{titulo}</h3>
      <p className="mt-1 text-xs text-[var(--text-faint)]">{nota}</p>
      {linhas.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-faint)]">Nada no período.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-[var(--text-faint)]">
              <tr>
                <th className="py-1 pr-3">Canal</th>
                <th className="py-1 pr-3 text-right">Cadastros</th>
                <th className="py-1 pr-3 text-right">Analisaram</th>
                <th className="py-1 pr-3 text-right" title="Criou assinatura na Stripe, mesmo recusada ou cancelada depois">Tentaram assinar</th>
                <th className="py-1 pr-3 text-right">Pagando hoje</th>
                <th className="py-1 text-right" title="Pagando hoje / cadastros">Conversão</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.canal} className="border-t border-[var(--border-subtle)] text-[var(--text-soft)]">
                  <td className="py-1.5 pr-3">{nomear ? NOME_CANAL[l.canal] ?? l.canal : l.canal}</td>
                  <td className="py-1.5 pr-3 text-right">{l.cadastros}</td>
                  <td className="py-1.5 pr-3 text-right">{l.analisaram}</td>
                  <td className="py-1.5 pr-3 text-right">{l.assinaram}</td>
                  <td className="py-1.5 pr-3 text-right font-semibold text-[var(--tone-up-1)]">{l.ativos}</td>
                  <td className="py-1.5 text-right">{pct(l.ativos, l.cadastros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * Aba "Origem" (05/10/2026): de onde vem quem cadastra, analisa e assina.
 * Os dados ficam no banco (`User.acquisitionSource` e `firstTouchAttribution`)
 * e esta tela so le, sem gravar nada. Ver `acquisition-report.ts`.
 */
export function OrigemPainel() {
  const { getToken, isSignedIn } = useAuth();
  const [dias, setDias] = useState(30);

  const query = useQuery<Relatorio, Error>({
    queryKey: ['admin-acquisition', dias],
    enabled: Boolean(isSignedIn),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const token = await getToken({ skipCache: true });
      const res = await fetch(buildApiUrl(`/api/admin/acquisition?dias=${dias}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Falha ao carregar (${res.status})`);
      return res.json();
    },
  });

  const dados = query.data;

  return (
    <section className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">De onde vem quem assina</h2>
        <div className="flex flex-wrap gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              onClick={() => setDias(p.dias)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                dias === p.dias ? 'bg-[var(--fill-5)] text-[var(--text-primary)]' : 'text-[var(--text-faint)] hover:text-[var(--text-soft)]'
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading && <p className="text-sm text-[var(--text-faint)]">Carregando…</p>}
      {query.error && <p className="text-sm text-[var(--tone-down-2)]">{query.error.message}</p>}

      {dados && (
        <>
          <Tabela
            titulo="O que a pessoa respondeu"
            nota='Pergunta "How did you find Tickrify?" no painel. Pega o que o rastreio não vê: ChatGPT, indicação, fórum. Sem o seu acesso manual e sem contas admin.'
            linhas={dados.declarada}
            nomear
          />
          <Tabela
            titulo="Primeiro acesso (rastreio técnico)"
            nota="UTM do link ou o site de onde a pessoa veio na primeira visita. Vazio quando ela digitou o endereço ou o navegador não informou."
            linhas={dados.tecnica}
          />
          <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Últimas respostas</h3>
            {dados.respostas.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--text-faint)]">Nenhuma resposta no período.</p>
            ) : (
              <ul className="mt-3 space-y-1.5 text-sm">
                {dados.respostas.map((r, i) => (
                  <li key={`${r.email ?? 'sem-email'}-${i}`} className="flex flex-wrap items-baseline gap-x-2 border-t border-[var(--border-subtle)] pt-1.5 text-[var(--text-soft)]">
                    <span className="font-medium text-[var(--text-primary)]">{NOME_CANAL[r.canal] ?? r.canal}</span>
                    {r.detalhe ? <span className="text-[var(--text-dim)]">{`"${r.detalhe}"`}</span> : null}
                    <span className="text-[11px] text-[var(--text-faint)]">
                      {`${r.email ?? 'sem e-mail'} · ${r.respondidoEm ? new Date(r.respondidoEm).toLocaleDateString('pt-BR') : ''}`}
                    </span>
                    {r.assinou ? <span className="text-[11px] font-semibold text-[var(--tone-up-1)]">assinou</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

export default OrigemPainel;
