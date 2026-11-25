import { Chip, Estado, Kpi, Painel, Tabela, dataHora, seg, useAdminQuery, usd } from '@/components/admin/AdminUi';

type Janela = {
  signups: number;
  analysis: {
    analyses: number;
    failed: number;
    byState: Record<string, number>;
    byAction: Record<string, number>;
    agreement: Record<string, number>;
    decidedBy: Record<string, number>;
    withoutMajority: number;
    readerLabels: { label: string; seen: number; failures: number; topError: string | null }[];
    strongRead: number;
    readerFailures: number;
    readersSeen: number;
    totalMsP50: number | null;
    totalMsP90: number | null;
    costUsd: number;
    costPerAnalysisUsd: number | null;
  };
  alerts: { triggered: number; armed: number; invalidated: number; notified: number; notifyDelayP50Ms: number | null; notifyDelayP90Ms: number | null };
};
type Inicio = {
  generatedAt: string;
  /** "Ask about this analysis": respondidas e custo por dia UTC, mais novo primeiro. Ausente em backend antigo. */
  questions?: { day: string; questions: number; costUsd: number }[];
  today: Janela;
  week: Janela;
  activeTrials: number;
  subscribers: number;
  activeAlerts: number;
  twelveData: { day: string; total: number; analysis: number; monitor: number; sweeper: number; minute: number; exhausted: boolean; store: string; dailyLimit: number; perMinute: number } | null;
};

const ESTADO: Record<string, string> = { ENTER_NOW: 'Enter now', WATCH: 'Watch', NO_TRADE: 'No trade', ARMED: 'Armado (antigo)' };
const ACAO: Record<string, string> = {
  buy_now: 'Compra agora', sell_now: 'Venda agora', buy_pullback: 'Compra no recuo', sell_pullback: 'Venda no recuo',
  buy_breakout: 'Compra no rompimento', sell_breakout: 'Venda no rompimento', wait: 'Esperar',
};

/** "12 de 40 (30%)": parte de um total, ou "-" sem total. */
function parteDe(parte: number, total: number) {
  return total ? `${parte} de ${total} (${Math.round((100 * parte) / total)}%)` : '-';
}

const somaValores = (map: Record<string, number>) => Object.values(map).reduce((sum, n) => sum + n, 0);

/** Falhas por leitor (A, B, C...) com o erro mais comum de cada um. */
function falhasPorLeitor(leitores: Janela['analysis']['readerLabels']) {
  const comFalha = leitores.filter((l) => l.failures > 0);
  return comFalha.length ? (
    <ul className="space-y-0.5">
      {comFalha.map((l) => (
        <li key={l.label} className="break-words">{`${l.label}: ${l.failures} de ${l.seen}${l.topError ? ` (${l.topError})` : ''}`}</li>
      ))}
    </ul>
  ) : (
    '-'
  );
}

/** "Compra agora: 3 · Esperar: 5", do maior para o menor. */
function lista(map: Record<string, number>, nomes: Record<string, string>) {
  const itens = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return itens.length ? (
    <ul className="space-y-0.5">
      {itens.map(([k, n]) => (
        <li key={k}>{`${nomes[k] ?? k}: ${n}`}</li>
      ))}
    </ul>
  ) : (
    '-'
  );
}

function Linha({ rotulo, hoje, semana }: { rotulo: string; hoje: React.ReactNode; semana: React.ReactNode }) {
  return (
    <tr className="border-t border-[var(--border-subtle)] align-top">
      <td className="py-1.5 pr-3 text-[var(--text-dim)]">{rotulo}</td>
      <td className="py-1.5 pr-3 tabular-nums">{hoje}</td>
      <td className="py-1.5 tabular-nums">{semana}</td>
    </tr>
  );
}

/** Aba "Inicio": hoje e ultimos 7 dias. So leitura (`GET admin/home`). */
export default function InicioPainel() {
  const query = useAdminQuery<Inicio>('home', 60_000);
  const d = query.data;
  const t = d?.twelveData;
  const usoTwelve = t ? t.total / t.dailyLimit : 0;

  return (
    <section className="space-y-4">
      <Estado query={query} />
      {d ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
            <Kpi valor={d.today.signups} rotulo="cadastros hoje" nota={`${d.week.signups} em 7 dias`} />
            <Kpi valor={d.activeTrials} rotulo="trials ativos" />
            <Kpi valor={d.subscribers} rotulo="assinantes reais" nota="sem acesso manual e sem admin" />
            <Kpi valor={d.today.analysis.analyses} rotulo="análises hoje" nota={`${d.week.analysis.analyses} em 7 dias`} />
            <Kpi valor={usd(d.today.analysis.costUsd, 2)} rotulo="custo de IA hoje" nota={`${usd(d.today.analysis.costPerAnalysisUsd)} por análise`} />
            <Kpi valor={d.activeAlerts} rotulo="alertas ativos" />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Painel titulo="Análises" nota="Só análises concluídas entram nas contagens. Tipo de entrada e leitores só existem no motor novo." className="xl:col-span-2">
              <Tabela colunas={[{ rotulo: '' }, { rotulo: 'Hoje' }, { rotulo: '7 dias' }]}>
                <Linha rotulo="Concluídas" hoje={d.today.analysis.analyses} semana={d.week.analysis.analyses} />
                <Linha rotulo="Falharam" hoje={d.today.analysis.failed} semana={d.week.analysis.failed} />
                <Linha rotulo="Por estado final" hoje={lista(d.today.analysis.byState, ESTADO)} semana={lista(d.week.analysis.byState, ESTADO)} />
                <Linha rotulo="Por tipo de entrada" hoje={lista(d.today.analysis.byAction, ACAO)} semana={lista(d.week.analysis.byAction, ACAO)} />
                <Linha rotulo="Concordância dos leitores" hoje={lista(d.today.analysis.agreement, {})} semana={lista(d.week.analysis.agreement, {})} />
                <Linha
                  rotulo="Sem maioria"
                  hoje={parteDe(d.today.analysis.withoutMajority, somaValores(d.today.analysis.decidedBy))}
                  semana={parteDe(d.week.analysis.withoutMajority, somaValores(d.week.analysis.decidedBy))}
                />
                <Linha rotulo="Quem decidiu o voto" hoje={lista(d.today.analysis.decidedBy, {})} semana={lista(d.week.analysis.decidedBy, {})} />
                <Linha rotulo="Leitura forte (3 de 3)" hoje={d.today.analysis.strongRead} semana={d.week.analysis.strongRead} />
                <Linha
                  rotulo="Leitor que falhou"
                  hoje={`${d.today.analysis.readerFailures} de ${d.today.analysis.readersSeen}`}
                  semana={`${d.week.analysis.readerFailures} de ${d.week.analysis.readersSeen}`}
                />
                <Linha rotulo="Falhas por leitor" hoje={falhasPorLeitor(d.today.analysis.readerLabels)} semana={falhasPorLeitor(d.week.analysis.readerLabels)} />
                <Linha rotulo="Tempo total p50 / p90" hoje={`${seg(d.today.analysis.totalMsP50)} / ${seg(d.today.analysis.totalMsP90)}`} semana={`${seg(d.week.analysis.totalMsP50)} / ${seg(d.week.analysis.totalMsP90)}`} />
                <Linha rotulo="Custo de IA" hoje={usd(d.today.analysis.costUsd, 2)} semana={usd(d.week.analysis.costUsd, 2)} />
                <Linha rotulo="Custo por análise" hoje={usd(d.today.analysis.costPerAnalysisUsd)} semana={usd(d.week.analysis.costPerAnalysisUsd)} />
              </Tabela>
              <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                O custo soma só os leitores do motor (costUsd de cada um). A leitura do ativo no print não grava custo e fica de fora.
              </p>
            </Painel>

            <div className="space-y-4">
              <Painel titulo="Alertas do Watch" nota="Disparados no período. Armado e invalidado vêm da conferência nas velas no disparo.">
                <Tabela colunas={[{ rotulo: '' }, { rotulo: 'Hoje' }, { rotulo: '7 dias' }]}>
                  <Linha rotulo="Disparados" hoje={d.today.alerts.triggered} semana={d.week.alerts.triggered} />
                  <Linha rotulo="Setup armado" hoje={d.today.alerts.armed} semana={d.week.alerts.armed} />
                  <Linha rotulo="Setup invalidado" hoje={d.today.alerts.invalidated} semana={d.week.alerts.invalidated} />
                  <Linha rotulo="Avisados (e-mail ou Telegram)" hoje={d.today.alerts.notified} semana={d.week.alerts.notified} />
                  <Linha
                    rotulo="Atraso do aviso p50 / p90"
                    hoje={`${seg(d.today.alerts.notifyDelayP50Ms)} / ${seg(d.today.alerts.notifyDelayP90Ms)}`}
                    semana={`${seg(d.week.alerts.notifyDelayP50Ms)} / ${seg(d.week.alerts.notifyDelayP90Ms)}`}
                  />
                </Tabela>
                <p className="mt-2 text-[11px] text-[var(--text-faint)]">Atraso = do disparo (triggeredAt) até o envio (emailedAt). O instante exato da vela não fica na tabela.</p>
              </Painel>

              <Painel titulo="Perguntas sobre a análise" nota="Só as respondidas (falha não conta). Dia UTC.">
                {d.questions?.length ? (
                  <Tabela colunas={[{ rotulo: 'Dia' }, { rotulo: 'Perguntas' }, { rotulo: 'Custo' }]}>
                    {d.questions.map((q) => (
                      <tr key={q.day} className="border-t border-[var(--border-subtle)]">
                        <td className="py-1.5 pr-3 tabular-nums text-[var(--text-dim)]">{q.day}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{q.questions}</td>
                        <td className="py-1.5 tabular-nums">{usd(q.costUsd, 4)}</td>
                      </tr>
                    ))}
                  </Tabela>
                ) : (
                  <p className="text-sm text-[var(--text-faint)]">Nenhuma pergunta nos últimos 7 dias.</p>
                )}
              </Painel>

              <Painel titulo="Cota do Twelve Data" nota={t ? `Dia UTC ${t.day}, medidor em ${t.store === 'redis' ? 'Redis' : t.store}. Atualizado ${dataHora(d.generatedAt)}.` : 'Medidor indisponível.'}>
                {t ? (
                  <>
                    <div className="flex items-baseline justify-between text-sm text-[var(--text-primary)]">
                      <span className="tabular-nums">{`${t.total} de ${t.dailyLimit}`}</span>
                      {t.exhausted ? <Chip tom="ruim">esgotada</Chip> : usoTwelve > 0.8 ? <Chip tom="aviso">acima de 80%</Chip> : <Chip tom="ok">folga</Chip>}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded bg-[var(--fill-2)]">
                      <div className="h-full bg-[var(--text-secondary)]" style={{ width: `${Math.min(100, usoTwelve * 100)}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-dim)]">
                      {`Análise ${t.analysis} · monitor ${t.monitor} · sweeper ${t.sweeper} · minuto atual ${t.minute} de ${t.perMinute}`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-faint)]">Sem leitura.</p>
                )}
              </Painel>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
