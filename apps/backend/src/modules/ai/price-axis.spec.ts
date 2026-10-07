import { PRICE_AXIS_PROMPT, PRICE_AXIS_SCHEMA, sanitizePriceAxis } from './price-axis';

describe('leitura do eixo de precos (extensao, 06/10/2026)', () => {
  it('aceita a leitura quando o topo e maior que a base', () => {
    expect(sanitizePriceAxis({ top: 189.37, bottom: 173.85 })).toEqual({ top: 189.37, bottom: 173.85 });
  });

  it('sem eixo legivel, invertido, igual ou nao numerico vira null (sem linhas)', () => {
    expect(sanitizePriceAxis({ top: null, bottom: null })).toBeNull();
    expect(sanitizePriceAxis({ top: 1.30, bottom: 1.37 })).toBeNull();
    expect(sanitizePriceAxis({ top: 5, bottom: 5 })).toBeNull();
    expect(sanitizePriceAxis({ top: 'x', bottom: 1 })).toBeNull();
    expect(sanitizePriceAxis({ top: Number.NaN, bottom: 1 })).toBeNull();
    expect(sanitizePriceAxis(undefined)).toBeNull();
  });

  it('o schema so tem os dois numeros (nada de texto livre)', () => {
    expect(PRICE_AXIS_SCHEMA.required).toEqual(['top', 'bottom']);
    expect(PRICE_AXIS_SCHEMA.additionalProperties).toBe(false);
  });

  it('a instrucao manda atravessar a faixa de datas (o que derrubou o erro de 30 px para 7,5 px na medicao)', () => {
    expect(PRICE_AXIS_PROMPT).toContain('time/date axis strip');
    expect(PRICE_AXIS_PROMPT).toContain('very bottom pixel');
  });
});
