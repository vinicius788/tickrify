import { flagBool } from '../flags/feature-flags';
import {
  Recommendation,
  harmonizeConfidenceWithTrend,
  capConfidenceByConfluence,
  applyRiskRewardGuard,
} from './analysis-normalizer';
import { EconomicCalendarService } from '../../modules/calendar/calendar.service';
import { BROKEN_PLAN_RULES, MEASURE_ONLY_RULES, TradePlanRule } from './trade-plan-validator';

// ============================================================================
// DECISÃO DE SINAL — SEQUÊNCIA DETERMINÍSTICA ÚNICA (paridade adapter/worker)
// ----------------------------------------------------------------------------
// Antes, adapter e worker aplicavam guards diferentes:
//   - adapter: news guard ATIVO, R/R guard MORTO (lia parsed.analysis?.riskRewardTp1,
//     campo que a IA nunca devolve) → o mesmo gráfico podia receber veredito
//     diferente dependendo de qual caminho o Render usava.
// Esta função concentra TODA a sequência num lugar só, então os dois caminhos
// passam a decidir de forma idêntica. Conservadora por design: só REDUZ a
// confiança e só rebaixa para WAIT — nunca inventa um trade.
// Ordem: cap por tendência → cap por confluência → validador do plano →
// guard R/R → news guard → teto WAIT.
// ============================================================================

export interface SignalDecisionInput {
  /** Recomendação canônica vinda do modelo (BUY | SELL | WAIT). */
  recommendation: Recommendation;
  /** Confiança 0-100 já com piso aplicado (0 em gráfico válido vira 30). */
  flooredConfidence: number;
  trendStrength: unknown;
  factorsPresent: unknown;
  /** R/R no TP1 calculado a partir dos níveis (entry/SL/TP1), não do texto da IA. */
  riskRewardTp1: number | null | undefined;
  /** R/R no TP2 (alvo final). O guard usa o MELHOR alvo alcançável, não só o TP1. */
  riskRewardTp2?: number | null | undefined;
  /** Símbolo para consulta do calendário econômico (news guard). */
  symbol: string;
  /**
   * Regras do `validateTradePlan` que o plano quebrou. `direction` nunca chega
   * aqui: quem chama falha a análise antes (o tick volta).
   */
  planFailures?: TradePlanRule[];
  /** true quando `correctPriceMagnitude` reescreveu os níveis (BTC lido 10x menor etc.). */
  priceFixed?: boolean;
}

/** O que o validador fez com a resposta do modelo (vai ao PostHog). */
export type ValidatorAction = 'none' | 'fixed' | 'downgraded';

export interface SignalDecisionResult {
  recommendation: Recommendation;
  confidence: number;
  rrDowngraded: boolean;
  newsDowngraded: boolean;
  /** Descrição do evento que rebaixou o sinal (para log), quando houver. */
  newsEvent: string | null;
  validatorAction: ValidatorAction;
  /** Regras que rebaixaram o plano; `rr_below_min` é o guard de R/R. */
  validatorReasons: Array<TradePlanRule | 'rr_below_min'>;
  /** Regras quebradas que so medem (MEASURE_ONLY_RULES): o sinal nao muda. */
  validatorFlags: TradePlanRule[];
}

// Instância única: reaproveita o cache de 1h do calendário entre análises.
const calendar = new EconomicCalendarService();

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // O timer e cancelado quando o calendario responde antes; sem isso cada
  // analise deixava um timer vivo ate estourar o prazo.
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('calendar timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function decideSignal(
  input: SignalDecisionInput,
): Promise<SignalDecisionResult> {
  // 1) Caps de confiança — harmoniza com a força da tendência e com a
  //    confluência (checklist 0-7). Ambos só reduzem, nunca aumentam.
  const harmonized = capConfidenceByConfluence(
    harmonizeConfidenceWithTrend(input.flooredConfidence, input.trendStrength),
    input.factorsPresent,
  );

  // 2) Guard de R/R — usa o MELHOR alvo alcançável (TP1 ou TP2). Um trade com
  //    saída parcial é viável pelo alvo final: TP1 a 1.1R + TP2 a 2.3R NÃO deve
  //    morrer só porque o primeiro alvo é curto. Só rebaixa quando NEM o melhor
  //    alvo compensa o risco (< 1.2). Kill-switch: ENABLE_RR_GUARD=false.
  const bestRiskReward = [input.riskRewardTp1, input.riskRewardTp2]
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r))
    .reduce<number | null>((best, r) => (best === null || r > best ? r : best), null);
  // Validador do plano: stop antes da invalidação ou preço fora da faixa do
  // print vira WAIT (níveis preservados, confiança <= 45, igual ao guard de R/R).
  const failures = input.recommendation === 'WAIT'
    ? []
    : (input.planFailures ?? []).filter((rule) => !BROKEN_PLAN_RULES.includes(rule));
  const validatorFlags = failures.filter((rule) => MEASURE_ONLY_RULES.includes(rule));
  const planFailures = failures.filter((rule) => !MEASURE_ONLY_RULES.includes(rule));
  const planDowngraded = input.recommendation !== 'WAIT' && planFailures.length > 0;
  const validated: Recommendation = planDowngraded ? 'WAIT' : input.recommendation;
  const validatedConfidence = planDowngraded ? Math.min(harmonized, 45) : harmonized;

  const guarded = applyRiskRewardGuard(validated, validatedConfidence, bestRiskReward);

  let recommendation = guarded.recommendation;
  let confidence = guarded.confidence;
  let newsDowngraded = false;
  let newsEvent: string | null = null;

  // 3) News guard — não se opera em cima de notícia. Evento de impacto ALTO para
  //    a(s) moeda(s) do ativo a ≤45min (ou que saiu há ≤15min) → WAIT, confiança ≤45.
  //    Best-effort: falha do calendário nunca bloqueia. Kill-switch: ENABLE_NEWS_GUARD=false.
  if (flagBool('ENABLE_NEWS_GUARD') && recommendation !== 'WAIT') {
    try {
      const { events } = await raceTimeout(
        calendar.getEventsForSymbol(String(input.symbol || ''), new Date(), 2),
        6_000,
      );
      // degraded (fonte fora do ar) não é tratado aqui: o guard já é
      // best-effort por design — se não dá pra checar, segue sem rebaixar.
      // calendar.service.ts já loga a falha em si; não duplicar aqui.
      const imminent = (events || []).find(
        (e) =>
          e.impact === 'High' &&
          typeof e.minutesUntil === 'number' &&
          e.minutesUntil >= -15 &&
          e.minutesUntil <= 45,
      );
      if (imminent) {
        recommendation = 'WAIT';
        confidence = Math.min(confidence, 45);
        newsDowngraded = true;
        newsEvent = `${imminent.country} ${imminent.title} (${imminent.minutesUntil}min)`;
      }
    } catch {
      // segue normal — guard é proteção extra, nunca bloqueio
    }
  }

  // 4) Teto de 60% para WAIT — "AGUARDAR 100%" parece super-sinal e confunde;
  //    a confiança aqui fala da leitura, não de um trade.
  if (recommendation === 'WAIT') {
    confidence = Math.min(confidence, 60);
  }

  const validatorReasons: SignalDecisionResult['validatorReasons'] = planDowngraded ? [...planFailures] : [];
  if (guarded.downgraded) validatorReasons.push('rr_below_min');

  return {
    recommendation,
    confidence,
    rrDowngraded: guarded.downgraded,
    newsDowngraded,
    newsEvent,
    validatorAction: validatorReasons.length > 0 ? 'downgraded' : input.priceFixed ? 'fixed' : 'none',
    validatorReasons,
    validatorFlags,
  };
}
