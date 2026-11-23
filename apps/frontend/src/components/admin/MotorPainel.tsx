import { CLASSE_ATIVO, Chip, Estado, Painel, TIPO_ENTRADA, Tabela, dataHora, pct, rFmt, useAdminQuery, type Tom } from '@/components/admin/AdminUi';

type Stats = {
  analyses: number;
  clearPct: number | null;
  closedTrades: number;
  win: number;
  loss: number;
  timeout: number;
  meanR: number | null;
  decision: 'keep' | 'disable' | 'wait';
  verdict: string;
};
type Report = {
  since: string | null;
  total: Stats;
  byEntry: { entry: string; stats: Stats }[];
  byClass: { assetClass: string; stats: Stats }[];
  agreement: { agreement: string; count: number }[];
  noCandles: { reason: string; count: number }[];
};

const MOTIVO_SEM_VELAS: Record<string, string> = {
  symbol_timeout: 'Leitura do ativo passou do tempo',
  symbol_unreadable: 'Ativo ilegível no print',
  timeframe_unreadable: 'Tempo gráfico ilegível',
  timeout: 'Etapa de dados passou do tempo',
  error: 'Erro na etapa de dados',
  provider_quota: 'Cota do Twelve Data',
  source_unavailable: 'Fonte de velas fora do ar',
  provider_unconfigured: 'Fonte sem chave',
  unsupported_asset: 'Ativo sem fonte de velas',
  stale_withheld: 'Print antigo, velas retidas',
  not_recorded: 'Motivo não registrado',
};
const TOM: Record<Stats['decision'], Tom> = { keep: 'ok', disable: 'ruim', wait: 'aviso' };
const COLUNAS = [
  { rotulo: '' }, { rotulo: 'Análises', direita: true }, { rotulo: 'Operação clara', direita: true },
  { rotulo: 'Trades fechados', direita: true }, { rotulo: 'W/L/T', direita: true }, { rotulo: 'R por trade', direita: true }, { rotulo: 'Regra' },
];

function Linha({ rotulo, s, forte }: { rotulo: string; s: Stats; forte?: boolean }) {
  return (
    <tr className={`border-t border-[var(--border-subtle)] ${forte ? 'font-medium text-[var(--text-primary)]' : ''}`}>
      <td className="py-1.5 pr-3">{rotulo}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{s.analyses}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{pct(s.clearPct)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{s.closedTrades}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{`${s.win}/${s.loss}/${s.timeout}`}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{rFmt(s.meanR)}</td>
      <td className="py-1.5"><Chip tom={TOM[s.decision]}>{s.verdict}</Chip></td>
    </tr>
  );
}

/** Aba "Motor": o motor novo por tipo de entrada e classe de ativo, com a regra do projeto. So leitura (`GET admin/engine`). */
export default function MotorPainel() {
  const query = useAdminQuery<Report>('engine', 60_000);
  const data = query.data;
  const totalVotos = data ? data.agreement.reduce((sum, a) => sum + a.count, 0) : 0;

  return (
    <section className="space-y-4">
      <Estado query={query} />
      {data && data.total.analyses === 0 ? <p className="text-sm text-[var(--text-faint)]">Ainda não há análise do motor novo (com votos dos leitores).</p> : null}
      {data && data.total.analyses > 0 ? (
        <>
          <Painel titulo="Regra do projeto" nota={`Só análises do motor novo (result.engine.vote)${data.since ? `, desde ${dataHora(data.since)}` : ''}. R por trade é o do rastreador, líquido de spread.`}>
            <p className="text-sm text-[var(--text-soft)]">
              Precisa de n &gt;= 30 trades fechados para decidir. Mantém com R &gt;= -0,05R. Alerta em -0,15R ou pior. Entre os dois, espera.
            </p>
          </Painel>

          <Painel titulo="Por tipo de entrada" nota="Agora, recuo, rompimento ou esperar, como o código escolheu.">
            <Tabela colunas={COLUNAS}>
              <Linha rotulo="Todas" s={data.total} forte />
              {data.byEntry.map((e) => (
                <Linha key={e.entry} rotulo={TIPO_ENTRADA[e.entry] ?? e.entry} s={e.stats} />
              ))}
            </Tabela>
          </Painel>

          <div className="grid gap-4 xl:grid-cols-3">
            <Painel titulo="Por classe de ativo" className="xl:col-span-2">
              <Tabela colunas={COLUNAS}>
                {data.byClass.map((c) => (
                  <Linha key={c.assetClass} rotulo={CLASSE_ATIVO[c.assetClass] ?? c.assetClass} s={c.stats} />
                ))}
              </Tabela>
            </Painel>

            <div className="space-y-4">
              <Painel titulo="Concordância dos leitores" nota="Quantos leitores votaram igual.">
                <ul className="space-y-1 text-sm text-[var(--text-soft)]">
                  {data.agreement.map((a) => (
                    <li key={a.agreement} className="flex justify-between gap-3">
                      <span>{a.agreement}</span>
                      <span className="tabular-nums">{`${a.count} (${pct((100 * a.count) / totalVotos)})`}</span>
                    </li>
                  ))}
                </ul>
              </Painel>

              <Painel titulo="Análises sem velas, por motivo">
                {data.noCandles.length === 0 ? (
                  <p className="text-sm text-[var(--text-soft)]">Nenhuma.</p>
                ) : (
                  <ul className="space-y-0.5 text-sm text-[var(--text-soft)]">
                    {data.noCandles.map((item) => (
                      <li key={item.reason} className="flex justify-between gap-3">
                        <span>{MOTIVO_SEM_VELAS[item.reason] ?? item.reason}</span>
                        <span className="tabular-nums">{item.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Painel>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
