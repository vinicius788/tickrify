/**
 * Veredito do trader — fonte ÚNICA de verdade.
 *
 * Extraído do MyTrades em 27/07/2026 porque o Dashboard passou a precisar da
 * mesma lógica (loop de cobrança do fechamento). Se cada tela tiver a sua
 * cópia, elas divergem na primeira mudança e o win rate exibido fica errado.
 *
 * IMPORTANTE — dois conceitos com nomes parecidos que NÃO podem se misturar:
 *   • `userVerdict` no banco = o que o TRADER diz que fez (isto aqui).
 *   • `outcome` no banco     = o que o MERCADO fez, medido pelo sweeper 48h
 *     depois (WIN/LOSS/ABSTAIN/...). Nunca é escrito por esta UI.
 * A API expõe o userVerdict no campo `outcome` da resposta, por retrocompat.
 */

import { getRecommendationMeta } from '@/lib/trading-ui';

/**
 * `NO_FILL` = o preco nunca chegou na entrada proposta (28/09/2026, pedido do
 * dono). Fecha a cobranca, mas nao e trade: fica fora do win rate e do P&L,
 * igual ao WAIT. Diferente de "Did not take it", que so apaga a marcacao.
 */
export type Verdict = 'TP1' | 'TP2' | 'SL' | 'OPEN' | 'NO_FILL' | null;

/**
 * A analise propos uma operacao? BUY/SELL sim; WAIT/HOLD nao (24/09/2026,
 * pedido do dono). Aguardar nao e trade: nao tem entrada, entao nao tem TP,
 * Stop nem valor a marcar, e nao pode aparecer como "pendente" esperando um
 * resultado que nunca vai existir. Continua contando como ANALISE feita.
 */
export function isTradeCall(recommendation: unknown, signalState?: unknown): boolean {
  if (signalState === 'WATCH' || signalState === 'NO_TRADE') return false;
  return getRecommendationMeta(recommendation).tone !== 'hold';
}

/** Converte o valor do backend para o rótulo da UI. */
export function verdictFromOutcome(o: unknown): Verdict {
  switch (String(o || '')) {
    case 'tp1': return 'TP1';
    case 'tp2': return 'TP2';
    case 'stop': return 'SL';
    case 'open': return 'OPEN';
    case 'no_fill': return 'NO_FILL';
    default: return null;
  }
}

/** Converte o rótulo da UI para o valor aceito pelo backend. */
export function outcomeFromVerdict(v: Verdict): string | null {
  switch (v) {
    case 'TP1': return 'tp1';
    case 'TP2': return 'tp2';
    case 'SL': return 'stop';
    case 'OPEN': return 'open';
    case 'NO_FILL': return 'no_fill';
    default: return null;
  }
}

/**
 * Veredito efetivo de uma analise. O SERVIDOR e a fonte da verdade; `pending`
 * e so a marcacao otimista desta tela, enquanto o servidor ainda nao confirmou
 * (a tela muda no clique, sem esperar a rede). Quem escreve tira a entrada de
 * `pending` depois que a gravacao confirma e a lista e relida.
 *
 * Ate 25/09/2026 o `pending` vinha do localStorage e VALIA PARA SEMPRE, acima
 * do servidor. Resultado real: "Vou entrar" clicado num aparelho gravava
 * "aberto" ali para sempre; marcar TP/Stop em outro aparelho, ou na aba My
 * Trades (que tinha copia propria), corrigia o servidor, mas aquele aparelho
 * continuava cobrando "1 trade still open" indefinidamente. Nao voltar a
 * persistir a marcacao local.
 */
export function resolveVerdict(
  analysis: { id: string; outcome?: unknown },
  pending: Record<string, Verdict>,
): Verdict {
  if (Object.prototype.hasOwnProperty.call(pending, analysis.id)) {
    return pending[analysis.id] ?? null;
  }
  return verdictFromOutcome((analysis as unknown as Record<string, unknown>).outcome);
}

/** Tira uma analise do mapa de marcacoes pendentes (depois de confirmada ou desfeita). */
export function withoutPending(pending: Record<string, Verdict>, id: string): Record<string, Verdict> {
  if (!Object.prototype.hasOwnProperty.call(pending, id)) return pending;
  const next = { ...pending };
  delete next[id];
  return next;
}

/** Cores por resultado. Tokens de styles/trading-tokens.css (claro e escuro). */
export const VERDICT_CFG = {
  TP1:  { bg: 'var(--verdict-tp1-bg)', border: 'var(--verdict-tp1-border)', text: 'var(--verdict-tp1)' },
  TP2:  { bg: 'var(--verdict-tp2-bg)', border: 'var(--verdict-tp2-border)', text: 'var(--verdict-tp2)' },
  SL:   { bg: 'var(--verdict-sl-bg)', border: 'var(--verdict-sl-border)', text: 'var(--verdict-sl)' },
  OPEN: { bg: 'var(--verdict-open-bg)', border: 'var(--verdict-open-border)', text: 'var(--verdict-open)' },
  NO_FILL: { bg: 'var(--verdict-nofill-bg)', border: 'var(--verdict-nofill-border)', text: 'var(--verdict-nofill)' },
} as const;

// ── Cobrança do fechamento (bloco do dashboard) ────────────────────────────

/**
 * Idade mínima antes de cobrar o fechamento de um trade em aberto.
 *
 * 12h é deliberado: cobrar o resultado de uma análise feita há 5 minutos é
 * irritante, não tem resposta possível, e ensina o usuário a ignorar o bloco —
 * que é exatamente o comportamento que mata este loop.
 */
export const VERDICT_MIN_AGE_MS = 12 * 60 * 60 * 1000;

/** Quantas linhas o bloco mostra por vez. O resto vai para o "ver todas". */
export const VERDICT_MAX_ROWS = 3;

const SNOOZE_KEY = 'tickrify_verdict_snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** "Agora não" — esconde o bloco de cobrança por 24h. */
export function snoozeVerdictPrompt() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* storage indisponível */ }
}

export function isVerdictPromptSnoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}
