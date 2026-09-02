/**
 * Corpo da rota PUT /api/ai/strategy.
 *
 * A validacao REAL e o `sanitizeStrategyProfile`, que trabalha por whitelist.
 * Este DTO existe so para o Nest rejeitar corpo com forma absurda antes de
 * chegar la. NUNCA confie neste DTO como fronteira de seguranca: ele deixa
 * passar string arbitraria dentro dos arrays, e e o sanitize que descarta.
 */
export class SetStrategyDto {
  timeframes?: unknown;
  sessions?: unknown;
  instruments?: unknown;
  setups?: unknown;
  direction?: unknown;
  minRiskReward?: unknown;
}
