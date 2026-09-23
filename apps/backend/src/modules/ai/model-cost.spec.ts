import {
  computeCost,
  extractUsage,
  formatCostLog,
  REVENUE_PER_TICK_USD,
} from './model-cost';
import { resolveReasoningEffort } from './openai-params';

describe('extractUsage', () => {
  it('lê o formato real da OpenAI, incluindo reasoning_tokens', () => {
    expect(
      extractUsage({
        prompt_tokens: 12_000,
        completion_tokens: 8_000,
        total_tokens: 20_000,
        completion_tokens_details: { reasoning_tokens: 5_500 },
      }),
    ).toEqual({
      promptTokens: 12_000,
      completionTokens: 8_000,
      reasoningTokens: 5_500,
      totalTokens: 20_000,
    });
  });

  it('nunca lança: usage ausente, nulo ou com lixo vira zero', () => {
    for (const bad of [undefined, null, {}, { prompt_tokens: 'abc' }, { prompt_tokens: -5 }]) {
      expect(() => extractUsage(bad)).not.toThrow();
      expect(extractUsage(bad).promptTokens).toBe(0);
    }
  });
});

describe('computeCost', () => {
  const usage = {
    promptTokens: 20_000,
    completionTokens: 10_000,
    reasoningTokens: 7_500,
    totalTokens: 30_000,
  };

  it('NÃO conta os reasoning_tokens duas vezes', () => {
    const c = computeCost('gpt-5.6-luna', usage, 3);
    expect(c.costUsd).toBeCloseTo(0.016, 6);
    expect(
      computeCost('gpt-5.6-luna', { ...usage, reasoningTokens: 0 }, 3).costUsd,
    ).toBeCloseTo(c.costUsd!, 6);
  });

  it('deep a 3 ticks tem receita teórica de $0.435 acima do custo de API estimado no luna', () => {
    const c = computeCost('gpt-5.6-luna', usage, 3);
    expect(c.revenueUsd).toBeCloseTo(0.435, 6);
    expect(c.overBudget).toBe(false);
  });

  it('o teto configurado de 32K de saída cabe por pouco na receita de um deep no terra', () => {
    const ceiling = {
      promptTokens: 20_000,
      completionTokens: 32_000,
      reasoningTokens: 29_500,
      totalTokens: 52_000,
    };
    expect(computeCost('gpt-5.6-luna', ceiling, 3).overBudget).toBe(false);
    expect(computeCost('gpt-5.6-terra', ceiling, 3).costUsd).toBeCloseTo(0.424, 6);
    expect(computeCost('gpt-5.6-terra', ceiling, 3).overBudget).toBe(false);
  });

  it('modelo desconhecido devolve custo null em vez de inventar preço', () => {
    const c = computeCost('modelo-que-nao-existe', usage, 1);
    expect(c.costUsd).toBeNull();
    expect(c.overBudget).toBe(false);
  });

  it('a receita por tick reflete o plano de $29/200 ticks', () => {
    expect(REVENUE_PER_TICK_USD).toBeCloseTo(0.145, 6);
  });
});

describe('formatCostLog', () => {
  it('marca quando o custo passa da receita', () => {
    const over = computeCost(
      'gpt-5.6-sol',
      { promptTokens: 20_000, completionTokens: 32_000, reasoningTokens: 0, totalTokens: 52_000 },
      1,
    );
    expect(formatCostLog('gpt-5.6-sol', 'quick', over)).toContain('CUSTO ACIMA DA RECEITA');
  });

  it('não quebra com modelo fora da tabela', () => {
    const c = computeCost('desconhecido', extractUsage({}), 1);
    expect(formatCostLog('desconhecido', 'quick', c)).toContain('cost=unknown');
  });
});

describe('resolveReasoningEffort', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('sem env setada devolve undefined (comportamento de hoje, nada muda)', () => {
    delete process.env.AI_REASONING_EFFORT_QUICK;
    delete process.env.AI_REASONING_EFFORT_DEEP;
    expect(resolveReasoningEffort('quick')).toBeUndefined();
    expect(resolveReasoningEffort('deep')).toBeUndefined();
  });

  it('separa quick de deep', () => {
    process.env.AI_REASONING_EFFORT_QUICK = 'low';
    process.env.AI_REASONING_EFFORT_DEEP = 'medium';
    expect(resolveReasoningEffort('quick')).toBe('low');
    expect(resolveReasoningEffort('deep')).toBe('medium');
  });

  it('IGNORA valor inválido — typo no Render não pode derrubar 100% das análises', () => {
    process.env.AI_REASONING_EFFORT_DEEP = 'muito_alto';
    expect(resolveReasoningEffort('deep')).toBeUndefined();
  });
});
