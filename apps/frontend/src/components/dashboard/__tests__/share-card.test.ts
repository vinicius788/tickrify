import { describe, expect, it, vi } from 'vitest';
import { buildShareText, drawShareCard, publicAction, publicScenario, wrapText, type ShareCardData } from '@/components/dashboard/ShareCard';

/**
 * O card de compartilhamento é a única superfície do produto que sai da tela e
 * circula sozinha. Duas coisas nele falham em SILÊNCIO, e são exatamente estas
 * que os testes abaixo travam:
 *
 *  1. `wrapText` — texto que não cabe não gera erro nenhum no Canvas. Ele
 *     simplesmente é desenhado para fora da imagem e some. Quem gerou o card
 *     não descobre; quem vê o post lê uma frase cortada no meio.
 *  2. `buildShareText` — é texto PÚBLICO, pré-preenchido, que a pessoa posta
 *     sem reler. Uma alegação de performance entrando aqui é a mesma classe de
 *     problema que a auditoria de 27/07/2026 passou uma sprint removendo da
 *     vitrine, só que agora publicada em nome do usuário.
 */

/** Medida determinística: 10px por caractere. Não depende de fonte nem de DOM. */
const measure = (text: string) => text.length * 10;

const baseData: ShareCardData = {
  symbol: 'BTCUSDT',
  timeframe: '4H',
  scenario: 'BULLISH',
  action: 'BUY',
  tone: 'buy',
  read: 'Reclaim of the 4H order block with volume.',
  date: new Date('2026-09-01T12:00:00Z'),
};

describe('wrapText', () => {
  it('nunca devolve linha mais larga que o limite', () => {
    const lines = wrapText(measure, 'alpha beta gamma delta epsilon zeta eta theta', 100, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(100);
  });

  it('respeita o teto de linhas', () => {
    const lines = wrapText(measure, 'um dois tres quatro cinco seis sete oito nove dez', 60, 3);
    expect(lines).toHaveLength(3);
  });

  it('marca com reticências quando corta, para o leitor saber que continua', () => {
    const lines = wrapText(measure, 'um dois tres quatro cinco seis sete oito nove dez', 60, 3);
    expect(lines[2].endsWith('…')).toBe(true);
  });

  it('não corta quando o texto inteiro cabe', () => {
    const lines = wrapText(measure, 'cabe certinho', 200, 4);
    expect(lines).toEqual(['cabe certinho']);
  });

  it('quebra palavra maior que a linha inteira em vez de deixar vazar', () => {
    const lines = wrapText(measure, 'supercalifragilisticexpialidocious', 100, 2);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(100);
  });

  it('devolve lista vazia para texto ausente', () => {
    expect(wrapText(measure, '', 100, 4)).toEqual([]);
    expect(wrapText(measure, '   ', 100, 4)).toEqual([]);
  });
});

describe('rótulos públicos de cenário e ação', () => {
  it('mantém o cenário separado da recomendação operacional', () => {
    expect(publicScenario('bullish')).toBe('BULLISH');
    expect(publicScenario('bearish')).toBe('BEARISH');
    expect(publicScenario('neutral')).toBe('NEUTRAL');
    expect(publicScenario('')).toBe('NEUTRAL');
  });

  it('usa WAIT como ação pública para HOLD, sem alterar BUY e SELL', () => {
    expect(publicAction('HOLD')).toBe('WAIT');
    expect(publicAction('WAIT')).toBe('WAIT');
    expect(publicAction('BUY')).toBe('BUY');
    expect(publicAction('SELL')).toBe('SELL');
  });

  it('cai em WAIT quando a ação vem vazia', () => {
    expect(publicAction('')).toBe('WAIT');
  });

  it('preserva o cenário bullish mesmo quando a ação é aguardar', () => {
    const text = buildShareText({ ...baseData, action: 'HOLD', tone: 'buy' });
    expect(text).not.toContain('HOLD');
    expect(text).toContain('read BULLISH and advised waiting');
  });
});

describe('buildShareText', () => {
  it('distingue cenário neutro de ação de aguardar', () => {
    expect(buildShareText({ ...baseData, scenario: 'NEUTRAL', action: 'HOLD', tone: 'hold' })).toContain(
      'read NEUTRAL and advised waiting',
    );
  });

  it('nomeia a direção quando existe', () => {
    expect(buildShareText(baseData)).toContain('read BULLISH and outlined a buy setup');
  });

  it('leva o link da /accuracy com UTM, que é o motivo de o card existir', () => {
    const text = buildShareText(baseData);
    expect(text).toContain('https://tickrify.com/accuracy');
    expect(text).toContain('utm_source=x');
  });

  it('afirma que não é sinal', () => {
    expect(buildShareText(baseData).toLowerCase()).toContain('not a signal');
  });

  it('NÃO expõe entrada, stop nem alvo: post com nível de preço lê como sinal', () => {
    const text = buildShareText(baseData).toLowerCase();
    for (const forbidden of ['entry', 'stop', 'target', 'take profit', '$']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('NÃO cita confiança: o score saiu do produto em 30/09/2026 por não prever nada', () => {
    const text = buildShareText(baseData).toLowerCase();
    expect(text).not.toContain('confidence');
    expect(text).not.toContain('%');
  });

  it('NÃO promete resultado nem cita taxa de acerto: número só sai da /accuracy', () => {
    const text = buildShareText(baseData).toLowerCase();
    for (const forbidden of ['win rate', 'accurate', 'profit', 'guarantee', 'roi']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('drawShareCard', () => {
  it('desenha o mesmo cenário e a mesma ação do texto, inclusive WAIT com viés bullish', async () => {
    const written: string[] = [];
    const noop = () => {};
    const ctx = {
      scale: noop,
      fillRect: noop,
      fillText: (value: string) => { written.push(value); },
      measureText: (value: string) => ({ width: value.length * 10 }),
      createRadialGradient: () => ({ addColorStop: noop }),
      beginPath: noop,
      moveTo: noop,
      arcTo: noop,
      closePath: noop,
      fill: noop,
      stroke: noop,
    } as unknown as CanvasRenderingContext2D;
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['image'], { type: 'image/png' }));
    });
    const data = { ...baseData, action: 'WAIT' } as ShareCardData;

    try {
      await drawShareCard(data);
      expect(written.join('')).toContain('BULLISH');
      expect(written).toContain('ACTION: WAIT');
      expect(buildShareText(data)).toContain('read BULLISH and advised waiting');
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }
  });
});
