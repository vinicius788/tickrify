import { describe, expect, it } from 'vitest';
import { fractionsFromAxis, placeLevels } from '../levels';

describe('placeLevels', () => {
  // Fracoes reais da analise de exemplo EURJPY (motor, 18/09/2026).
  const y = { entry: 0.261, stop: 0.409, tp1: 0.043, tp2: 0 };

  it('posiciona cada nivel na altura do recorte', () => {
    const marks = placeLevels(y, 500);
    expect(marks.find((m) => m.key === 'entry')).toEqual({ key: 'entry', top: 131, edge: null });
    expect(marks.find((m) => m.key === 'stop')).toEqual({ key: 'stop', top: 205, edge: null });
    expect(marks.find((m) => m.key === 'tp1')).toEqual({ key: 'tp1', top: 22, edge: null });
  });

  it('nivel fora da area visivel vira etiqueta de borda, nunca linha no lugar errado', () => {
    const marks = placeLevels({ ...y, stop: 1 }, 500);
    expect(marks.find((m) => m.key === 'tp2')).toEqual({ key: 'tp2', top: null, edge: 'above' });
    expect(marks.find((m) => m.key === 'stop')).toEqual({ key: 'stop', top: null, edge: 'below' });
  });

  it('sem fracao (null, fora de 0..1 ou nao numero) o nivel some', () => {
    const marks = placeLevels({ entry: 0.3, stop: null, tp1: 1.7, tp2: Number.NaN }, 500);
    expect(marks.map((m) => m.key)).toEqual(['entry']);
  });

  it('sem entrada nao desenha nada (as linhas so fazem sentido em volta dela)', () => {
    expect(placeLevels({ entry: null, stop: 0.4, tp1: 0.1, tp2: 0.05 }, 500)).toEqual([]);
  });
});

describe('fractionsFromAxis', () => {
  // Medicao real de 06/10: o entryY/stopY da IA errou ate ~80 px. A altura agora
  // sai de conta: preco do topo e da base do eixo -> fracao exata de cada nivel.
  const axis = { top: 189, bottom: 175 };

  it('posiciona cada preco pela escala do eixo', () => {
    const f = fractionsFromAxis({ entry: 182, stop: 185.5, tp1: 178.5, tp2: 175 }, axis)!;
    expect(f.entry).toBeCloseTo(0.5, 5);
    expect(f.stop).toBeCloseTo(0.25, 5);
    expect(f.tp1).toBeCloseTo(0.75, 5);
    expect(f.tp2).toBeCloseTo(1, 5);
  });

  it('preco fora da escala vira borda (0 ou 1), nunca linha fora do grafico', () => {
    const f = fractionsFromAxis({ entry: 182, stop: 195, tp1: 170, tp2: null }, axis)!;
    expect(f.stop).toBe(0);
    expect(f.tp1).toBe(1);
    expect(f.tp2).toBeNull();
  });

  it('sem escala confiavel nao ha linhas (lancamento sem linhas)', () => {
    expect(fractionsFromAxis({ entry: 182, stop: 185, tp1: 178, tp2: 176 }, null)).toBeNull();
    expect(fractionsFromAxis({ entry: 182, stop: 185, tp1: 178, tp2: 176 }, { top: 175, bottom: 189 })).toBeNull();
    expect(fractionsFromAxis({ entry: 182, stop: 185, tp1: 178, tp2: 176 }, { top: Number.NaN, bottom: 1 })).toBeNull();
    // Entrada fora da escala: o eixo lido nao bate com o grafico, melhor nao desenhar.
    expect(fractionsFromAxis({ entry: 250, stop: 185, tp1: 178, tp2: 176 }, axis)).toBeNull();
  });
});
