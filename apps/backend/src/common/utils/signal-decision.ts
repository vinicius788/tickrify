import {
  Recommendation,
  harmonizeConfidenceWithTrend,
  capConfidenceByConfluence,
  applyRiskRewardGuard,
} from './analysis-normalizer';
import { EconomicCalendarService } from '../../modules/calendar/calendar.service';

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
// Ordem: cap por tendência → cap por confluência → guard R/R → news guard → teto WAIT.
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
}

export interface SignalDecisionResult {
  recommendation: Recommendation;
  confidence: number;
  rrDowngraded: boolean;
  newsDowngraded: boolean;
  /** Descrição do evento que rebaixou o sinal (para log), quando houver. */
  newsEvent: string | null;
}

// Instância única: reaproveita o cache de 1h do calendário entre análises.
const calendar = new EconomicCalendarService();

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('calendar timed out')), ms)),
  ]);
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
  const guarded = applyRiskRewardGuard(input.recommendation, harmonized, bestRiskReward);

  let recommendation = guarded.recommendation;
  let confidence = guarded.confidence;
  let newsDowngraded = false;
  let newsEvent: string | null = null;

  // 3) News guard — não se opera em cima de notícia. Evento de impacto ALTO para
  //    a(s) moeda(s) do ativo a ≤45min (ou que saiu há ≤15min) → WAIT, confiança ≤45.
  //    Best-effort: falha do calendário nunca bloqueia. Kill-switch: ENABLE_NEWS_GUARD=false.
  if (process.env.ENABLE_NEWS_GUARD !== 'false' && recommendation !== 'WAIT') {
    try {
      const events = await raceTimeout(
        calendar.getEventsForSymbol(String(input.symbol || ''), new Date(), 2),
        6_000,
      );
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

  return {
    recommendation,
    confidence,
    rrDowngraded: guarded.downgraded,
    newsDowngraded,
    newsEvent,
  };
}
