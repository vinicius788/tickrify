import { describe, expect, it } from 'vitest';
import {
  normalizeRiskFactorsForView,
  parseStructureChecklist,
  softenDashes,
} from '@/components/dashboard/AnalysisResult';

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
});
