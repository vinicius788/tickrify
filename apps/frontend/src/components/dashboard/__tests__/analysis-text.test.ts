import { describe, expect, it } from 'vitest';
import {
  classifyWaitTrigger,
  cleanModelText,
  normalizeRiskFactorsForView,
  parseStructureChecklist,
  softenDashes,
  splitItems,
} from '@/components/dashboard/AnalysisResult';
import { computeDirectionalRiskReward } from '@/lib/trade-plan';

describe('risk/reward shown for trade levels', () => {
  it('keeps valid long/short plans and refuses contradictory ones', () => {
    expect(computeDirectionalRiskReward(100, 95, 110, 'buy')).toBe(2);
    expect(computeDirectionalRiskReward(100, 105, 90, 'sell')).toBe(2);
    expect(computeDirectionalRiskReward(100, 95, 90, 'buy')).toBeNull();
    expect(computeDirectionalRiskReward(100, 105, 110, 'sell')).toBeNull();
    expect(computeDirectionalRiskReward(100, 105, 90, 'buy')).toBeNull();
    expect(computeDirectionalRiskReward(100, 95, 110, 'sell')).toBeNull();
  });
});

/**
 * Estes testes existem por causa de um bug que chegou em PRODUÇÃO (25/08/2026).
 *
 * A versão anterior de `normalizeRiskFactorsForView` quebrava o texto em
 * `/[\n•-]+/`. O hífen ali dentro parte qualquer palavra composta, e os filtros
 * seguintes apagavam a metade órfã. Na tela do usuário, um fator de risco
 * começava em "stage trend" (de "Late-stage") e outro terminava em "cannot be
 * volume" (de "volume-confirmed"). Aviso de risco perdendo frase pela metade.
 *
 * A regra que estes testes protegem é uma só: NADA do que o modelo escreveu
 * pode sumir. Formatação feia é aceitável; texto faltando não é.
 */

describe('normalizeRiskFactorsForView', () => {
  const ITENS = [
    '1) Late-stage trend - the move is already extended, increasing pullback/reversal risk.',
    '2) A close below 4230.20 weakens the bullish OB thesis; a close below 4225.05 invalidates the trade protection.',
    '3) Buy-side liquidity above 4286.85 may produce a sharp rejection.',
    '4) Volume is not visible, so the displacement cannot be volume-confirmed.',
  ];

  it('preserva as palavras compostas quando recebe um array', () => {
    const out = normalizeRiskFactorsForView(ITENS);

    expect(out).toHaveLength(4);
    expect(out[0]).toContain('Late-stage trend');
    expect(out[2]).toContain('Buy-side liquidity');
    expect(out[3]).toContain('volume-confirmed');
  });

  it('separa a numeração quando tudo vem numa string só', () => {
    const out = normalizeRiskFactorsForView(ITENS.join(' '));

    expect(out).toHaveLength(4);
    expect(out[0].startsWith('Late-stage')).toBe(true);
    expect(out[3]).toContain('volume-confirmed');
  });

  it('não perde nenhum caractere do texto original', () => {
    const semEspaco = (texto: string) => texto.replace(/[\s\d).\]]/g, '');
    const entrada = ITENS.join(' ');
    const saida = normalizeRiskFactorsForView(entrada).join(' ');

    expect(semEspaco(saida)).toBe(semEspaco(entrada));
  });

  it('cola continuação em minúscula no item anterior em vez de descartar', () => {
    const out = normalizeRiskFactorsForView(['Risco relevante aqui.', 'continuação da frase.']);

    expect(out).toHaveLength(1);
    expect(out[0]).toBe('Risco relevante aqui. continuação da frase.');
  });

  it('devolve lista vazia sem quebrar quando não há nada', () => {
    expect(normalizeRiskFactorsForView(null)).toEqual([]);
    expect(normalizeRiskFactorsForView('')).toEqual([]);
    expect(normalizeRiskFactorsForView([])).toEqual([]);
  });
});

describe('softenDashes', () => {
  it('troca travessão cercado de espaço por vírgula', () => {
    expect(softenDashes('HTF bias — visible bullish structure')).toBe(
      'HTF bias, visible bullish structure',
    );
  });

  it('travessão colado na palavra tambem vira vírgula; en dash de intervalo fica', () => {
    expect(softenDashes('Liquidity filter: IN FAVOR—sell-side at 4260')).toBe('Liquidity filter: IN FAVOR, sell-side at 4260');
    expect(softenDashes('zone 4230–4240')).toBe('zone 4230–4240');
  });

  it('NÃO toca em intervalo de preço nem em palavra composta', () => {
    expect(softenDashes('bullish OB at 4230.20-4240.50')).toBe('bullish OB at 4230.20-4240.50');
    expect(softenDashes('cannot be volume-confirmed')).toBe('cannot be volume-confirmed');
  });
});

describe('parseStructureChecklist', () => {
  // Já passou pelo softenDashes, que é como o texto chega na tela.
  const TEXTO =
    '✅ HTF bias, visible bullish HH/HL structure and upside displacement. ' +
    '✅ Premium/Discount zone, planned entry 4238.80 is below the midpoint. ' +
    '✅ R:R, planned entry 4238.80, stop 4225.05, TP2 4281.70 gives approximately 1:3.1. ' +
    '❌ MTF evidence is inferred from one chart rather than displayed charts. ' +
    '→ 6/7 → BUY limit setup.';

  it('lê os critérios, o placar e o veredito', () => {
    const out = parseStructureChecklist(TEXTO);

    expect(out.items).toHaveLength(4);
    expect(out.score).toBe('6/7');
    expect(out.verdict).toBe('BUY limit setup');
  });

  it('marca aprovado e reprovado pelo símbolo', () => {
    const out = parseStructureChecklist(TEXTO);

    expect(out.items.map((item) => item.ok)).toEqual([true, true, true, false]);
  });

  it('separa rótulo curto do detalhe, sem cortar o "R:R" no dois-pontos', () => {
    const out = parseStructureChecklist(TEXTO);

    expect(out.items[0].label).toBe('HTF bias');
    expect(out.items[2].label).toBe('R:R');
    expect(out.items[2].detail).toContain('stop 4225.05');
  });

  it('sem rótulo reconhecível, o texto inteiro vira detalhe e nada some', () => {
    const out = parseStructureChecklist(TEXTO);

    expect(out.items[3].label).toBe('');
    expect(out.items[3].detail).toContain('MTF evidence is inferred');
  });

  it('devolve vazio quando o formato não é reconhecido, para o chamador cair no texto cru', () => {
    expect(parseStructureChecklist('').items).toEqual([]);
    expect(parseStructureChecklist('um parágrafo comum sem marcador').items).toEqual([]);
  });

  it('não exibe placar divergente e mantém N/A como não avaliável', () => {
    const text = '✅ Visible bias | ✅ Zone | ✅ ICT setup | ✅ Anti-retail | ✅ Structure | ❌ R:R | N/A verified MTF → 4/7 passes → HOLD-WATCH';
    const out = parseStructureChecklist(text);
    expect(out.items).toHaveLength(7);
    expect(out.items.filter((item) => item.ok)).toHaveLength(5);
    expect(out.items[6]).toMatchObject({ ok: false, notApplicable: true, detail: 'N/A verified MTF' });
    expect(out.score).toBeNull();
    expect(out.scoreMismatch).toBe(true);
    expect(out.verdict).toBe('HOLD-WATCH');
  });

  // C1 synthetic: a warning is neither approval nor a failed criterion.
  it.each(['⚠', '⚠️'])('preserves caution marker %s without changing the score', marker => {
    const text = `✅ Bias | ✅ Zone | ✅ ICT | ✅ Anti-retail | ✅ R:R | ❌ MTF | ${marker} Structure: close still pending → 5/7 → BUY`;
    const out = parseStructureChecklist(text);
    expect(out.items[6]).toMatchObject({ ok: false, notApplicable: false, warning: true,
      label: 'Structure', detail: 'close still pending' });
    expect(out.score).toBe('5/7');
    expect(out.scoreMismatch).toBe(false);
    expect(out.items.filter(item => item.ok)).toHaveLength(5);
  });

  it('mantém o placar quando os sete critérios concordam', () => {
    const text = '✅ Bias | ✅ Zone | ✅ ICT | ❌ Anti-retail | ❌ Structure | ❌ R:R | N/A MTF → 3/7 passes → WAIT';
    const out = parseStructureChecklist(text);
    expect(out.items).toHaveLength(7);
    expect(out.score).toBe('3/7');
    expect(out.scoreMismatch).toBe(false);
    expect(out.items[6].notApplicable).toBe(true);
  });
});

/**
 * Segundo lote, do mesmo dia. Estes vêm do dado REAL gravado em produção, lido
 * pela API antes de mexer em qualquer linha.
 *
 * `identifiedPatterns` chega decorado com emoji, um por padrão, e a versão
 * anterior de `splitItems` quebrava em VÍRGULA e ponto-e-vírgula — prosa não é
 * CSV. O resultado na tela eram etiquetas de tamanhos aleatórios, uma delas com
 * a palavra "hesitation" sozinha.
 */
const PADROES_REAIS =
  '🎯 Bullish OB/FVG confluence at 4240.50-4255.95 — preferred long limit zone. ' +
  '🔹 Bullish BOS through the prior resistance area near 4230.20. ' +
  '💧 Unswept buy-side liquidity at 4281.70-4286.85 above price. ' +
  '🕯️ Upper-wick rejection and tight consolidation near 4281.70-4286.85 — hesitation, but no confirmed bearish CHoCH. ' +
  '🔁 Bullish re-accumulation/continuation structure remains more likely than a reversal.';

describe('parseStructureChecklist: formato do motor v10 (PASS/FAIL)', () => {
  const v10 = 'C1 FAIL: higher timeframe unavailable. C2 PASS: near 85,400 support. C3 PASS: sweep and reclaim. '
    + 'C4 PASS: buyers absorb. C5 PASS: trigger 85,600. C6 PASS: 1.8R to TP2. C7 FAIL: equal highs above. 5/7 ARMED';

  it('le os 7 itens, o placar e o estado do fim', () => {
    const c = parseStructureChecklist(v10);
    expect(c.items).toHaveLength(7);
    expect(c.items.filter((i) => i.ok)).toHaveLength(5);
    expect(c.items[0]).toEqual({ ok: false, notApplicable: false, label: 'C1', detail: 'higher timeframe unavailable' });
    expect(c.items[6].detail).toBe('equal highs above');
    expect(c).toMatchObject({ score: '5/7', verdict: 'ARMED', scoreMismatch: false });
  });

  it('aceita rotulo entre o codigo e o veredito', () => {
    const c = parseStructureChecklist('C1 Context: PASS HTF up; C2 Location: FAIL mid-range; C3 PASS; C4 PASS; C5 FAIL; C6 PASS; C7 PASS. 5/7, WATCH.');
    expect(c.items[0]).toMatchObject({ ok: true, label: 'C1 Context', detail: 'HTF up' });
    expect(c.items[1]).toMatchObject({ ok: false, label: 'C2 Location', detail: 'mid-range' });
    expect(c).toMatchObject({ score: '5/7', verdict: 'WATCH' });
  });

  it('placar que nao bate com a lista nao aparece', () => {
    expect(parseStructureChecklist(v10.replace('5/7', '6/7'))).toMatchObject({ score: null, scoreMismatch: true });
  });

  it('sem os 7 itens cai na leitura antiga', () => {
    expect(parseStructureChecklist('C1 PASS a. C2 FAIL b.').items).toHaveLength(0);
  });
});

describe('splitItems', () => {
  it('usa o emoji como fronteira do item, não a vírgula', () => {
    const itens = splitItems(PADROES_REAIS);

    expect(itens).toHaveLength(5);
    expect(itens[3]).toContain('hesitation, but no confirmed bearish CHoCH');
  });

  it('não corta palavra composta nem intervalo de preço', () => {
    const itens = splitItems(PADROES_REAIS).map((item) => cleanModelText(item));

    expect(itens[0]).toContain('4240.50-4255.95');
    expect(itens[2]).toContain('buy-side liquidity');
  });

  it('entrega o item já sem emoji depois do cleanModelText', () => {
    const itens = splitItems(PADROES_REAIS).map((item) => cleanModelText(item));

    expect(itens.join(' ')).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(itens[0].startsWith('Bullish OB/FVG confluence')).toBe(true);
  });

  it('sem emoji nenhum, devolve o texto inteiro como um item só', () => {
    const prosa = 'Visible moving-average overlays are rising, supporting momentum.';

    expect(splitItems(prosa)).toEqual([prosa]);
  });
});

describe('stripEmoji via cleanModelText', () => {
  it('tira decoração e mantém o conteúdo', () => {
    expect(cleanModelText('💧 Unswept buy-side liquidity at 4281.70-4286.85')).toBe(
      'Unswept buy-side liquidity at 4281.70-4286.85',
    );
  });

  it('não come sinal de porcentagem, cifrão nem seta de texto', () => {
    expect(cleanModelText('Risk $15.45 and 3.1:1 R/R at 62%')).toBe('Risk $15.45 and 3.1:1 R/R at 62%');
  });
});

/**
 * Plano condicional do WAIT (23/09/2026). A regra que importa: sem preco no
 * texto do motor, nao ha plano (o card nao pode inventar nivel).
 */
describe('classifyWaitTrigger', () => {
  it('sem preco no texto: nao ha plano', () => {
    expect(classifyWaitTrigger('Wait for a clean break of structure before entering.')).toBeNull();
    expect(classifyWaitTrigger(null)).toBeNull();
    expect(classifyWaitTrigger('')).toBeNull();
  });

  it('gatilho de compra com preco', () => {
    expect(
      classifyWaitTrigger('If price closes above 4,352.50 (confirming BOS), the setup becomes BUY with entry near 4,350.'),
    ).toBe('buy');
  });

  it('gatilho de venda com preco, inclusive no idioma de saida', () => {
    expect(classifyWaitTrigger('If price closes below 1.0840, the setup becomes SELL.')).toBe('sell');
    expect(classifyWaitTrigger('Se o preço fechar abaixo de 1,0840, o setup vira VENDA.')).toBe('sell');
  });

  it('prosa com "long wick" ou "short-term" nao vira lado', () => {
    expect(classifyWaitTrigger('A long wick rejected 4,360; short-term structure is unclear.')).toBe('neutral');
  });

  it('texto que cita os dois lados fica neutro', () => {
    expect(classifyWaitTrigger('BUY above 4,360 or SELL below 4,330.')).toBe('neutral');
  });
});
