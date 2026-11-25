import { useState } from 'react';
import { Chip, Estado, Painel, Tabela, dataHora, seg, useAdminQuery, usd, type Tom } from '@/components/admin/AdminUi';
import { WhatAISaw } from '@/components/dashboard/WhatAISaw';
import { buildCodeSummaryText, isCodeSummary, type CodeSummaryTexts } from '@/lib/code-summary';
import { formatAssetPrice } from '@/lib/trading-ui';
import { LOCALES, getTranslations } from '@/lib/i18n';
import { LanguageContext } from '@/lib/i18n/LanguageContext';
import type { AIAnalysisResponse } from '@/lib/api';

type Hit = { id: string; createdAt: string; email: string | null; symbol: string | null; timeframe: string | null; status: string; signalState: string | null; action: string | null; agreement: string | null };
type Reader = { label: string; provider: string; model: string | null; status: string; ms: number | null; costUsd: number | null; state: string | null; direction: string | null; veto: string | null; error?: string };
type Result = NonNullable<AIAnalysisResponse['fullResponse']> & {
  engine?: {
    version?: string; provider?: string | null; data_mode?: string; signal_state?: string; validator_action?: string;
    validator_reasons?: string[]; validator_flags?: unknown[]; timings?: Record<string, number | null>;
    contract?: { no_trade_reason?: string | null; entry?: number | null; stop?: number | null; targets?: number[]; invalidation?: number | null } | null;
    readers?: Reader[]; vote?: { agreement?: string; strongRead?: boolean; earlyMajority?: boolean; decidedBy?: string } | null;
  } | null;
};
type Detail = {
  id: string; createdAt: string; status: string; errorCode: string | null; recommendation: string | null; promptVer: number | null; model: string | null;
  imageUrl: string | null; user: { id: string; email: string | null }; result: Result | null; groundingStats: unknown;
  track: { status: string; outcome: string | null; touched: boolean; filled: boolean; reason: string | null; mfeR: number | null; maeR: number | null } | null;
  /** Ausente em backend antigo. */
  questions?: { id: string; question: string; answer: string; provider: string | null; model: string | null; costUsd: number | null; ms: number | null; createdAt: string }[];
};

const EN = getTranslations('en');
/** O texto sempre em ingles, como a pessoa viu na tela, mesmo com o painel em outro idioma. */
const ENGLISH = { language: 'en' as const, t: EN, setLanguage: () => undefined };

const TOM_LEITOR: Record<string, Tom> = { used: 'ok', ignored: 'neutro', failed: 'ruim' };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-t border-[var(--border-subtle)] py-1.5 text-sm first:border-t-0">
      <dt className="text-[var(--text-dim)]">{rotulo}</dt>
      <dd className="text-right tabular-nums text-[var(--text-primary)]">{valor ?? '-'}</dd>
    </div>
  );
}

function Analise({ id, onUsuario }: { id: string; onUsuario: (userId: string) => void }) {
  const query = useAdminQuery<Detail>(`analyses/${encodeURIComponent(id)}`, 60_000);
  const d = query.data;
  const r = d?.result ?? null;
  const symbol = r?.analysis?.symbol ?? r?.symbol ?? null;
  const price = (v: number | null) => formatAssetPrice(v, symbol, LOCALES.en);
  const codeSummary = r && isCodeSummary(r.codeSummary) ? r.codeSummary : null;
  const visto = codeSummary ? buildCodeSummaryText(codeSummary, EN.analysis.result.codeSummary as CodeSummaryTexts, price) : null;
  const motivoWait = codeSummary?.waitReason ? (EN.analysis.result.codeSummary as CodeSummaryTexts).reasons[codeSummary.waitReason] ?? codeSummary.waitReason : null;
  const engine = r?.engine ?? null;
  const readers = engine?.readers ?? [];
  const plano = r?.entryPlan ?? null;
  const bias = r?.candleBias ?? null;
  const notas = (r?.validatorNotes ?? []).map((n) => (typeof n === 'string' ? n : `${n.from ? `${n.from} → ` : ''}${n.to ?? ''} ${n.reason}`.trim()));
  const tempos = Object.entries(engine?.timings ?? {}).filter(([, v]) => v !== null && v !== undefined);

  return (
    <div className="space-y-4">
      <Estado query={query} />
      {d ? (
        <>
          <Painel>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-[var(--text-faint)]">{d.id}</span>
              <Chip tom={d.status === 'completed' ? 'ok' : d.status === 'failed' ? 'ruim' : 'aviso'}>{d.status}</Chip>
              {d.errorCode ? <Chip tom="ruim">{d.errorCode}</Chip> : null}
              <span className="text-[var(--text-dim)]">{dataHora(d.createdAt)}</span>
              <button type="button" className="text-[var(--text-primary)] underline underline-offset-2" onClick={() => onUsuario(d.user.id)}>
                {d.user.email ?? d.user.id}
              </button>
              <span className="text-[var(--text-faint)]">{`prompt v${d.promptVer ?? '?'} · ${d.model ?? 'modelo ?'} · motor ${engine?.version ?? 'anterior'}`}</span>
            </div>
          </Painel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Painel titulo="Print enviado">
              {d.imageUrl ? (
                <a href={d.imageUrl} target="_blank" rel="noreferrer">
                  <img src={d.imageUrl} alt="Print enviado pela pessoa" className="max-h-[520px] w-full rounded border border-[var(--border-subtle)] object-contain" />
                </a>
              ) : (
                <p className="text-sm text-[var(--text-faint)]">Sem imagem (apagada, ou o Storage não respondeu).</p>
              )}
            </Painel>

            <div className="space-y-4">
              <Painel titulo="O que a pessoa leu" nota="Texto do resumo pelo código, em inglês, com a mesma formatação de preço da tela.">
                {visto ? (
                  <>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{visto.headline}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--text-soft)]">{visto.text}</p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-faint)]">Análise do motor anterior: não tem resumo pelo código.</p>
                )}
              </Painel>

              <Painel titulo="Decisão final">
                <dl>
                  <Campo rotulo="Estado" valor={r?.signalState ?? engine?.signal_state} />
                  <Campo rotulo="Tipo de entrada" valor={codeSummary?.action} />
                  <Campo rotulo="Motivo de esperar" valor={motivoWait} />
                  <Campo rotulo="Motivo do contrato" valor={engine?.contract?.no_trade_reason} />
                  <Campo rotulo="Origem dos níveis" valor={r?.dataMode} />
                  <Campo rotulo="Ação do validador" valor={engine?.validator_action} />
                  <Campo rotulo="Motivos do validador" valor={engine?.validator_reasons?.join(', ')} />
                </dl>
                {notas.length ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-dim)]">
                    {notas.map((n, i) => (
                      <li key={`${i}-${n}`}>{n}</li>
                    ))}
                  </ul>
                ) : null}
              </Painel>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Painel titulo="Leitores" nota={engine?.vote ? `Concordância ${engine.vote.agreement ?? '-'} · decidido por ${engine.vote.decidedBy ?? '-'}${engine.vote.strongRead ? ' · leitura forte' : ''}${engine.vote.earlyMajority ? ' · maioria antecipada' : ''}` : 'Sem votos: análise do motor anterior.'}>
              {readers.length ? (
                <Tabela colunas={[{ rotulo: 'Leitor' }, { rotulo: 'Modelo' }, { rotulo: 'Estado' }, { rotulo: 'Voto' }, { rotulo: 'Veto' }, { rotulo: 'Tempo', direita: true }, { rotulo: 'Custo', direita: true }]}>
                  {readers.map((l) => (
                    <tr key={l.label} className="border-t border-[var(--border-subtle)] align-top">
                      <td className="py-1.5 pr-3">{`${l.label} (${l.provider})`}</td>
                      <td className="py-1.5 pr-3 text-xs">{l.model ?? '-'}</td>
                      <td className="py-1.5 pr-3">
                        <Chip tom={TOM_LEITOR[l.status] ?? 'neutro'}>{l.status}</Chip>
                        {l.error ? <div className="mt-0.5 text-[11px] text-[var(--tone-down-2)]">{l.error}</div> : null}
                      </td>
                      <td className="py-1.5 pr-3 text-xs">{`${l.state ?? '-'} / ${l.direction ?? '-'}`}</td>
                      <td className="py-1.5 pr-3 text-xs">{l.veto ?? '-'}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{seg(l.ms)}</td>
                      <td className="py-1.5 text-right tabular-nums">{usd(l.costUsd)}</td>
                    </tr>
                  ))}
                </Tabela>
              ) : (
                <p className="text-sm text-[var(--text-faint)]">Nenhum leitor gravado.</p>
              )}
            </Painel>

            <Painel titulo="Entrada e níveis">
              {plano ? (
                <dl>
                  <Campo rotulo="Tipo" valor={`${plano.kind} (${plano.direction})`} />
                  <Campo rotulo="Entrada" valor={price(num(plano.entry))} />
                  <Campo rotulo="Stop" valor={price(num(plano.stopLoss))} />
                  <Campo rotulo="Alvo 1" valor={`${price(num(plano.takeProfit1))} (${num(plano.tp1R)?.toFixed(2) ?? '-'}R)`} />
                  <Campo rotulo="Alvo 2" valor={plano.takeProfit2 === null ? '-' : price(num(plano.takeProfit2))} />
                  <Campo rotulo="Nível do gatilho" valor={price(num(plano.level))} />
                  <Campo rotulo="Invalidação" valor={price(num(plano.invalidation))} />
                </dl>
              ) : (
                <p className="text-sm text-[var(--text-faint)]">Sem plano de entrada escolhido pelo código.</p>
              )}
              {codeSummary && (codeSummary.turnsBuyAbove !== null || codeSummary.turnsSellBelow !== null) ? (
                <p className="mt-2 text-xs text-[var(--text-dim)]">{`Vira compra acima de ${price(codeSummary.turnsBuyAbove)}; vira venda abaixo de ${price(codeSummary.turnsSellBelow)}.`}</p>
              ) : null}
            </Painel>

            <Painel titulo="Viés das velas" nota="Calculado pelo código com as velas reais; sem velas, não existe.">
              {bias ? (
                <dl>
                  <Campo rotulo="Direção" valor={bias.direction} />
                  <Campo rotulo="Placar" valor={bias.score} />
                  <Campo rotulo="Estrutura" valor={bias.structure} />
                  <Campo rotulo={`Tendência no ${bias.timeframes?.direction ?? '4h'}`} valor={bias.htfTrend} />
                  <Campo rotulo="Preço x EMA50" valor={bias.vsEma50} />
                  <Campo rotulo={`${bias.timeframes?.direction ?? '4h'} x EMA50`} valor={bias.htfVsEma50} />
                  <Campo rotulo="Esticado" valor={bias.stretched ? 'sim' : 'não'} />
                  <Campo rotulo="RSI(14)" valor={bias.rsi14 ?? null} />
                </dl>
              ) : (
                <p className="text-sm text-[var(--text-faint)]">Sem viés das velas.</p>
              )}
            </Painel>

            <Painel titulo="Tempos por etapa">
              {tempos.length ? (
                <dl>
                  {tempos.map(([k, v]) => (
                    <Campo key={k} rotulo={k} valor={seg(v)} />
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-[var(--text-faint)]">Sem tempos gravados.</p>
              )}
            </Painel>
          </div>

          {r ? (
            <LanguageContext.Provider value={ENGLISH}>
              <WhatAISaw fullResponse={r} formatPrice={price} />
            </LanguageContext.Provider>
          ) : null}

          <Painel titulo="Rastreador (o que o mercado fez)">
            {d.track ? (
              <dl>
                <Campo rotulo="Situação" valor={d.track.status} />
                <Campo rotulo="Desfecho" valor={d.track.outcome} />
                <Campo rotulo="Tocou / preencheu" valor={`${d.track.touched ? 'sim' : 'não'} / ${d.track.filled ? 'sim' : 'não'}`} />
                <Campo rotulo="Motivo (se pulou)" valor={d.track.reason} />
                <Campo rotulo="MFE / MAE (R)" valor={`${d.track.mfeR?.toFixed(2) ?? '-'} / ${d.track.maeR?.toFixed(2) ?? '-'}`} />
              </dl>
            ) : (
              <p className="text-sm text-[var(--text-faint)]">Ainda sem linha no rastreador (a janela pode estar aberta).</p>
            )}
          </Painel>

          <Painel titulo="Perguntas do trader">
            {d.questions?.length ? (
              <ol className="space-y-3">
                {d.questions.map((q) => (
                  <li key={q.id} className="text-sm">
                    <p className="font-medium text-[var(--text-primary)]">{q.question}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--text-soft)]">{q.answer}</p>
                    <p className="mt-1 text-[11px] text-[var(--text-faint)]">{`${dataHora(q.createdAt)} · ${q.model ?? q.provider ?? '-'} · ${seg(q.ms)} · ${usd(q.costUsd, 4)}`}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-[var(--text-faint)]">Nenhuma pergunta nesta análise.</p>
            )}
          </Painel>

          <details className="rounded border border-[var(--border-strong)] bg-[var(--fill-1)] p-3">
            <summary className="cursor-pointer text-sm text-[var(--text-soft)]">JSON completo do resultado</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-[var(--text-dim)]">{JSON.stringify({ result: d.result, groundingStats: d.groundingStats }, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </div>
  );
}

/** Aba "Inspetor de análise": busca por id, e-mail ou ativo e abre uma análise inteira. So leitura. */
export default function InspetorPainel({ analiseInicial, onUsuario }: { analiseInicial: string | null; onUsuario: (userId: string) => void }) {
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(analiseInicial);
  const termo = busca.trim();
  const lista = useAdminQuery<{ items: Hit[] }>(termo.length >= 2 ? `analyses?q=${encodeURIComponent(termo)}` : null);

  return (
    <section className="space-y-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setBusca(texto);
          setAberta(null);
        }}
      >
        <input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Id da análise, e-mail da pessoa ou ativo (XAUUSD)"
          aria-label="Buscar análise"
          className="min-w-0 flex-1 rounded border border-[var(--border-strong)] bg-[var(--bg-inset)] px-3 py-2 text-base text-[var(--text-primary)]"
        />
        <button type="submit" className="rounded border border-[var(--border-strong)] bg-[var(--fill-2)] px-4 py-2 text-sm text-[var(--text-primary)]">
          Buscar
        </button>
      </form>

      {termo.length >= 2 ? (
        <Painel titulo="Resultados" nota="Até 50, as mais novas primeiro.">
          <Estado query={lista} />
          {lista.data && lista.data.items.length === 0 ? <p className="text-sm text-[var(--text-faint)]">Nada encontrado.</p> : null}
          {lista.data && lista.data.items.length > 0 ? (
            <Tabela colunas={[{ rotulo: 'Quando' }, { rotulo: 'Pessoa' }, { rotulo: 'Ativo' }, { rotulo: 'Estado' }, { rotulo: 'Entrada' }, { rotulo: 'Leitores' }, { rotulo: '' }]}>
              {lista.data.items.map((h) => (
                <tr key={h.id} className={`border-t border-[var(--border-subtle)] ${aberta === h.id ? 'bg-[var(--fill-2)]' : ''}`}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{dataHora(h.createdAt)}</td>
                  <td className="py-1.5 pr-3">{h.email ?? '-'}</td>
                  <td className="py-1.5 pr-3">{h.symbol ? `${h.symbol}${h.timeframe ? ` ${h.timeframe}` : ''}` : '-'}</td>
                  <td className="py-1.5 pr-3">{h.status === 'completed' ? h.signalState ?? '-' : h.status}</td>
                  <td className="py-1.5 pr-3">{h.action ?? '-'}</td>
                  <td className="py-1.5 pr-3">{h.agreement ?? '-'}</td>
                  <td className="py-1.5">
                    <button type="button" className="text-[var(--text-primary)] underline underline-offset-2" onClick={() => setAberta(h.id)}>
                      abrir
                    </button>
                  </td>
                </tr>
              ))}
            </Tabela>
          ) : null}
        </Painel>
      ) : null}

      {aberta ? <Analise key={aberta} id={aberta} onUsuario={onUsuario} /> : null}
    </section>
  );
}
