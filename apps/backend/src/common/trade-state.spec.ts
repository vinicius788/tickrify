import { TRADE_RULES, priceSituation, sameAsset, stateForVerdict, verdictFor } from './trade-state';
import { MANAGEMENT_SCHEMA, buildManagementPrompt, finalizeManagement, type ManagementContext } from '../modules/ai/trade-management';

const ctx = (over: Partial<ManagementContext> = {}): ManagementContext => ({
  direction: 'BUY',
  status: 'in_trade',
  symbol: 'XAUUSD',
  timeframe: '1H',
  plannedEntry: 4160,
  entryType: 'limit',
  stopLoss: 4100,
  takeProfit1: 4300,
  takeProfit2: 4400,
  invalidationLevel: 4095,
  thesis: 'Bullish structure above the 4,100 order block.',
  entryPrice: 4162.5,
  hoursSinceAnalysis: 20,
  currentPrice: null,
  language: 'en',
  ...over,
});
const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ priceReadable: true, readPrice: 4200, reason: 'Holding above entry.', situation: 'on_track', action: 'hold', watch: 'Watch 4,250.', ...over });

describe('estado da operacao: regras por codigo', () => {
  it('preco digitado acima do alvo / abaixo do stop decide target_hit / stop_hit (BUY e SELL)', () => {
    expect(priceSituation('BUY', 4100, 4300, 4305)).toBe('target_hit');
    expect(priceSituation('BUY', 4100, 4300, 4099)).toBe('stop_hit');
    expect(priceSituation('BUY', 4100, 4300, 4200)).toBeNull();
    expect(priceSituation('SELL', 4230, 4050, 4040)).toBe('target_hit');
    expect(priceSituation('SELL', 4230, 4050, 4231)).toBe('stop_hit');
    expect(priceSituation('BUY', 4100, 4300, null)).toBeNull();
  });

  it('resultado antigo e estado andam juntos nos dois sentidos', () => {
    expect(verdictFor('in_trade')).toBe('open');
    expect(verdictFor('closed', 'target_hit')).toBe('tp1');
    expect(verdictFor('closed', 'stop_hit')).toBe('stop');
    expect(verdictFor('closed', 'manual')).toBeNull();
    expect(verdictFor('cancelled')).toBe('no_fill');
    expect(verdictFor('expired')).toBe('no_fill');
    expect(verdictFor('pending_order')).toBeUndefined();
    expect(stateForVerdict('open')).toEqual({ status: 'in_trade', closeReason: null });
    expect(stateForVerdict('tp2')).toEqual({ status: 'closed', closeReason: 'target_hit' });
    expect(stateForVerdict(null)).toEqual({ status: 'suggested', closeReason: null });
  });

  it('mesmo ativo ignora corretora e separador', () => {
    expect(sameAsset('FX:XAUUSD', 'XAU/USD')).toBe(true);
    expect(sameAsset('BTCUSDT.P', 'BINANCE:BTCUSDT')).toBe(true);
    expect(sameAsset('EURUSD', 'GBPUSD')).toBe(false);
    expect(sameAsset(null, 'EURUSD')).toBe(false);
  });

  it('custo e teto sao constantes faceis de mudar', () => {
    expect(TRADE_RULES.managementCheckCost).toBe(1);
    expect(TRADE_RULES.maxChecksPerTrade).toBeGreaterThan(0);
  });
});

describe('modo gerenciamento', () => {
  it('o schema nao tem como propor entrada nova nem trocar de direcao', () => {
    const keys = Object.keys(MANAGEMENT_SCHEMA.properties);
    expect(keys).toEqual(['priceReadable', 'readPrice', 'reason', 'situation', 'action', 'watch']);
    expect(MANAGEMENT_SCHEMA.properties.action.enum).not.toContain('buy');
    const prompt = buildManagementPrompt(ctx());
    expect(prompt).toContain('Never suggest a new entry');
    expect(prompt).toContain('real entry price 4162.5');
  });

  it('preco digitado acima do alvo vira target_hit por codigo, mesmo com a IA dizendo on_track', () => {
    const r = finalizeManagement(answer(), ctx({ currentPrice: 4310 }));
    expect(r).toMatchObject({ situation: 'target_hit', action: 'exit', decidedByPrice: true });
    const s = finalizeManagement(answer(), ctx({ currentPrice: 4090 }));
    expect(s).toMatchObject({ situation: 'stop_hit', action: 'exit' });
  });

  it('ordem pendente: so manter ou cancelar; zona nao atingida pode seguir esperando', () => {
    const keep = finalizeManagement(answer({ situation: 'on_track', action: 'wait' }), ctx({ status: 'pending_order', entryPrice: null }));
    expect(keep.action).toBe('wait');
    // A IA devolveu acao de trade aberto para uma ordem pendente: o codigo corrige.
    const coerced = finalizeManagement(answer({ situation: 'invalidated', action: 'exit' }), ctx({ status: 'pending_order' }));
    expect(coerced.action).toBe('cancel_order');
    const open = finalizeManagement(answer({ action: 'cancel_order' }), ctx());
    expect(open.action).toBe('hold');
  });

  it('sem preco digitado e sem leitura segura: unclear e pede o preco atual', () => {
    const r = finalizeManagement(answer({ priceReadable: false, readPrice: null, situation: 'on_track' }), ctx());
    expect(r).toMatchObject({ situation: 'unclear', needsCurrentPrice: true });
  });

  it('resposta fora do schema lanca (quem chama repete uma vez)', () => {
    expect(() => finalizeManagement('{"situation":"moon"}', ctx())).toThrow();
    expect(() => finalizeManagement('not json', ctx())).toThrow();
  });
});
