/** R/R só existe quando stop e alvo estão em lados opostos, na direção do sinal. */
export function computeDirectionalRiskReward(
  entry: number | null,
  stopLoss: number | null,
  takeProfit: number | null,
  tone: 'buy' | 'sell' | 'hold',
): number | null {
  if (entry === null || stopLoss === null || takeProfit === null) return null;
  if (![entry, stopLoss, takeProfit].every(Number.isFinite) ||
      entry <= 0 || stopLoss <= 0 || takeProfit <= 0) return null;
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (!(risk > 0) || !(reward > 0) || (stopLoss - entry) * (takeProfit - entry) >= 0) return null;
  if ((tone === 'buy' && !(stopLoss < entry && takeProfit > entry)) ||
      (tone === 'sell' && !(stopLoss > entry && takeProfit < entry))) return null;
  return Math.round((reward / risk) * 100) / 100;
}
