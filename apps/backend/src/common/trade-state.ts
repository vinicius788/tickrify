/**
 * ESTADO DA OPERACAO (13/10/2026) — regras puras, num lugar so.
 *
 * Por que existe: medido em 13/10 com 2 prints reais de ouro com a posicao
 * desenhada (ferramenta de posicao do TradingView), a analise normal tratou o
 * print como setup novo. Com uma compra desenhada, deu WAIT bearish e usou o
 * stop e o alvo desenhados como niveis proprios; com uma venda desenhada,
 * propos venda NOVA em 4.250, acima do stop desenhado (4.230). A IA nao sabe
 * que existe operacao: quem sabe e o trader, que marca aqui.
 *
 * Estados: suggested (sem linha) -> pending_order -> in_trade -> closed;
 * pending_order -> cancelled | expired. O resultado antigo (`userVerdict`,
 * usado pelo diario, P&L e My Trades) e gravado JUNTO, nos dois sentidos
 * (`verdictFor` / `stateForVerdict`): nunca existem duas verdades.
 *
 * Linhas de posicao no print sao so pista: a IA nunca afirma que a operacao
 * esta aberta sem o trader ter marcado, e o preco digitado pelo trader sempre
 * vence o que a IA le na imagem.
 */

export const TRADE_RULES = {
  /** Quanto uma checagem de gerenciamento custa: analises gratis ou ticks. */
  managementCheckCost: 1,
  /** Teto de checagens por operacao. */
  maxChecksPerTrade: 10,
  /** Janela para perguntar "este grafico e da sua operacao aberta?". */
  followUpWindowDays: 14,
  /** Ordem pendente vira `expired` depois disto sem ser marcada. */
  pendingOrderExpiryDays: 7,
} as const;

export const TRADE_STATUSES = ['pending_order', 'in_trade', 'closed', 'cancelled', 'expired'] as const;
export type TradeStatus = 'suggested' | (typeof TRADE_STATUSES)[number];
/** O que o trader pode marcar (expired e so o sistema). */
export const MARKABLE_STATUSES = ['pending_order', 'in_trade', 'closed', 'cancelled'] as const;
export type MarkableStatus = (typeof MARKABLE_STATUSES)[number];

export const CLOSE_REASONS = ['target_hit', 'stop_hit', 'breakeven', 'manual', 'invalidated', 'cancelled'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const SITUATIONS = ['on_track', 'near_target', 'near_stop', 'invalidated', 'target_hit', 'stop_hit', 'unclear'] as const;
export type TradeSituation = (typeof SITUATIONS)[number];

export const ACTIONS = ['hold', 'move_stop_to_breakeven', 'partial_exit', 'exit', 'cancel_order', 'wait'] as const;
export type TradeAction = (typeof ACTIONS)[number];

export type Direction = 'BUY' | 'SELL';

/** Uma linha do tempo simples (reaproveitavel pelo diario). */
export type TradeTimelineEntry = {
  status: TradeStatus;
  at: string;
  entryPrice?: number | null;
  closeReason?: CloseReason | null;
};

/**
 * Preco digitado pelo trader cruzou alvo ou stop? Decidido por CODIGO, nunca
 * pela IA. BUY: preco >= alvo = target_hit, preco <= stop = stop_hit (SELL
 * ao contrario). null = nenhum dos dois ou dado faltando.
 */
export function priceSituation(
  direction: Direction,
  stop: number | null | undefined,
  target: number | null | undefined,
  price: number | null | undefined,
): 'target_hit' | 'stop_hit' | null {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!ok(price)) return null;
  if (direction === 'BUY') {
    if (ok(target) && price >= target) return 'target_hit';
    if (ok(stop) && price <= stop) return 'stop_hit';
  } else {
    if (ok(target) && price <= target) return 'target_hit';
    if (ok(stop) && price >= stop) return 'stop_hit';
  }
  return null;
}

/** Estado da operacao -> resultado antigo (`userVerdict`). undefined = nao mexe. */
export function verdictFor(status: TradeStatus, reason?: CloseReason | null): string | null | undefined {
  if (status === 'in_trade') return 'open';
  if (status === 'cancelled' || status === 'expired') return 'no_fill';
  if (status === 'closed') {
    if (reason === 'target_hit') return 'tp1';
    if (reason === 'stop_hit') return 'stop';
    if (reason === 'breakeven') return 'breakeven';
    // Encerrou na mao ou por invalidacao: resultado desconhecido, sai do "aberto".
    return null;
  }
  if (status === 'suggested') return null;
  return undefined; // pending_order: ainda nao ha resultado
}

/** Resultado marcado no My Trades/diario -> estado da operacao. */
export function stateForVerdict(verdict: string | null): { status: TradeStatus; closeReason: CloseReason | null } {
  switch (verdict) {
    case 'open':
      return { status: 'in_trade', closeReason: null };
    case 'tp1':
    case 'tp2':
      return { status: 'closed', closeReason: 'target_hit' };
    case 'stop':
      return { status: 'closed', closeReason: 'stop_hit' };
    case 'breakeven':
      return { status: 'closed', closeReason: 'breakeven' };
    case 'no_fill':
      return { status: 'cancelled', closeReason: 'cancelled' };
    default:
      return { status: 'suggested', closeReason: null };
  }
}

/** A operacao ainda pede acompanhamento? */
export function isOpenStatus(status: TradeStatus): boolean {
  return status === 'pending_order' || status === 'in_trade';
}

/** Mesmo ativo? Compara sem prefixo de corretora e sem separador (FX:XAUUSD = XAU/USD). */
export function sameAsset(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) =>
    String(s || '')
      .toUpperCase()
      .replace(/^[A-Z0-9_]+:/, '')
      .replace(/(\.P|PERP)$/, '')
      .replace(/[^A-Z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  return Boolean(x) && x === y;
}
