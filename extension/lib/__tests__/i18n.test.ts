import { describe, expect, it } from 'vitest';
import { strings } from '../i18n';

describe('idioma do painel', () => {
  it('Chrome em portugues mostra portugues; o resto, ingles', () => {
    expect(strings('pt-BR').analyzeThisChart).toBe('Analisar este gráfico');
    expect(strings('pt').paywallFree).toBe('Seus planos de trade grátis acabaram');
    expect(strings('en-US').analyzeThisChart).toBe('Analyze this chart');
    expect(strings('ja').analyzeThisChart).toBe('Analyze this chart');
  });

  it('termos do motor viram portugues (limit, market) e o lado da entrada tambem', () => {
    const t = strings('pt-BR');
    expect(t.entry(t.entryType('limit'))).toBe('Entrada limite');
    expect(t.side('SELL', t.entryType('market'))).toBe('Venda a mercado');
    expect(t.entryType('outro')).toBe('outro');
    expect(strings('en').side('BUY', 'limit')).toBe('Buy limit');
  });

  it('nenhum texto em ingles leva travessao (regra do site)', () => {
    const flat = JSON.stringify(strings('en'), (_k, v) => (typeof v === 'function' ? v('x', 'y') : v));
    expect(flat).not.toMatch(/—/);
  });
});
