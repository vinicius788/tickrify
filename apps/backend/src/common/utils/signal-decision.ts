import { flagBool } from '../flags/feature-flags';
import {
  Recommendation,
  harmonizeConfidenceWithTrend,
  capConfidenceByConfluence,
  applyRiskRewardGuard,
} from './analysis-normalizer';
import { EconomicCalendarService } from '../../modules/calendar/calendar.service';
import { normalizeToBinancePerp } from '../../modules/market/market.service';
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
  /**
   * Regras que rebaixaram o plano; `rr_below_min` é o guard de R/R e
   * `news_event` o news guard (evento High na janela).
   */
  validatorReasons: Array<TradePlanRule | 'rr_below_min' | 'news_event'>;
  /** Regras quebradas que so medem (MEASURE_ONLY_RULES): o sinal nao muda. */
  validatorFlags: TradePlanRule[];
  /** O que o news guard conseguiu checar nesta decisao (so em memoria e log, nunca gravado). */
  newsGuardStatus: NewsGuardStatus;
}

/**
 * Resultado do news guard (19/10/2026). Politica ATUAL, sem mudanca: so
 * `event`/`degraded_event` rebaixam. `timeout`, `error` e `degraded_no_event`
 * seguem sem rebaixar (falha aberta), mas agora ficam distinguiveis de
 * `no_event` (checou e nao havia evento). Bloquear nesses casos seria politica
 * nova e depende do dono.
 *   disabled          ENABLE_NEWS_GUARD desligado
 *   skipped           o sinal ja era WAIT antes do guard (nada a checar)
 *   no_event          calendario respondeu, sem evento High na janela
 *   event             evento High na janela: rebaixou
 *   degraded_no_event fonte fora do ar; resposta (cache velho ou vazia) sem evento
 *   degraded_event    fonte fora do ar; o cache velho tinha o evento: rebaixou
 *   timeout           o calendario nao respondeu em 6 s
 *   error             o calendario lancou erro
 */
export type NewsGuardStatus =
  | 'disabled'
  | 'skipped'
  | 'no_event'
  | 'event'
  | 'degraded_no_event'
  | 'degraded_event'
  | 'timeout'
  | 'error';

class CalendarTimeoutError extends Error {}

// Instância única: reaproveita o cache de 1h do calendário entre análises.
const calendar = new EconomicCalendarService();

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // O timer e cancelado quando o calendario responde antes; sem isso cada
  // analise deixava um timer vivo ate estourar o prazo.
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new CalendarTimeoutError('calendar timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Cripto para o guard de limit com confirmacao, aceitando sufixo de corretora
 * (BTCUSDm da Exness, BTCUSD.pro, ETHUSD-P). So o guard usa: grounding,
 * calendario e sweeper seguem com `normalizeToBinancePerp` como antes. A base
 * continua tendo de estar na lista de cripto, entao ouro e forex nunca entram.
 */
export function isCryptoSymbolForGuard(symbol: unknown): boolean {
  const raw = String(symbol ?? '').trim();
  if (normalizeToBinancePerp(raw).isCrypto) return true;
  const head = raw.split(/[.\-_#]/)[0];
  if (head !== raw && normalizeToBinancePerp(head).isCrypto) return true;
  const exness = head.match(/^(.+?(?:USDT|USDC|USD))[mcz]$/i);
  return exness !== null && normalizeToBinancePerp(exness[1]).isCrypto;
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
  // Cripto com limit que exige confirmacao (19/10/2026): v12, 2 acertos em 19
  // planos decididos, -0,66R, contra -0,10R dos outros 35. Atras de chave
  // DESLIGADA: ligar muda o WAIT% de cripto. Fora de cripto segue so medindo.
  const measureOnly = (rule: TradePlanRule) =>
    MEASURE_ONLY_RULES.includes(rule) &&
    !(rule === 'limit_needs_confirmation' && flagBool('ENABLE_CRYPTO_CONFIRMATION_LIMIT_GUARD') &&
      isCryptoSymbolForGuard(input.symbol));
  const validatorFlags = failures.filter(measureOnly);
  const planFailures = failures.filter((rule) => !measureOnly(rule));
  const planDowngraded = input.recommendation !== 'WAIT' && planFailures.length > 0;
  const validated: Recommendation = planDowngraded ? 'WAIT' : input.recommendation;
  const validatedConfidence = planDowngraded ? Math.min(harmonized, 45) : harmonized;

  const guarded = applyRiskRewardGuard(validated, validatedConfidence, bestRiskReward);

  let recommendation = guarded.recommendation;
  let confidence = guarded.confidence;
  let newsDowngraded = false;
  let newsEvent: string | null = null;
  let newsGuardStatus: NewsGuardStatus = 'disabled';

  // 3) News guard — não se opera em cima de notícia. Evento de impacto ALTO para
  //    a(s) moeda(s) do ativo a ≤45min (ou que saiu há ≤15min) → WAIT, confiança ≤45.
  //    Best-effort: falha do calendário nunca bloqueia. Kill-switch: ENABLE_NEWS_GUARD=false.
  if (flagBool('ENABLE_NEWS_GUARD') && recommendation === 'WAIT') {
    newsGuardStatus = 'skipped';
  } else if (flagBool('ENABLE_NEWS_GUARD')) {
    try {
      const { events, degraded } = await raceTimeout(
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
      newsGuardStatus = imminent
        ? (degraded ? 'degraded_event' : 'event')
        : (degraded ? 'degraded_no_event' : 'no_event');
    } catch (error) {
      // segue normal — guard é proteção extra, nunca bloqueio
      newsGuardStatus = error instanceof CalendarTimeoutError ? 'timeout' : 'error';
    }
  }

  // 4) Teto de 60% para WAIT — "AGUARDAR 100%" parece super-sinal e confunde;
  //    a confiança aqui fala da leitura, não de um trade.
  if (recommendation === 'WAIT') {
    confidence = Math.min(confidence, 60);
  }

  const validatorReasons: SignalDecisionResult['validatorReasons'] = planDowngraded ? [...planFailures] : [];
  if (guarded.downgraded) validatorReasons.push('rr_below_min');
  // Antes de 19/10/2026 o news guard rebaixava sem deixar motivo (action 'none').
  // So registra: a decisao e a confianca ja foram tomadas acima.
  if (newsDowngraded) validatorReasons.push('news_event');

  return {
    recommendation,
    confidence,
    rrDowngraded: guarded.downgraded,
    newsDowngraded,
    newsEvent,
    validatorAction: validatorReasons.length > 0 ? 'downgraded' : input.priceFixed ? 'fixed' : 'none',
    validatorReasons,
    validatorFlags,
    newsGuardStatus,
  };
}
