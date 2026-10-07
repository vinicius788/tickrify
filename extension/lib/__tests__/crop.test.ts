import { describe, expect, it } from 'vitest';
import { cropRectToPixels, fitWithin } from '../crop';

const VIEW = { width: 1440, height: 900 };

describe('cropRectToPixels', () => {
  it('captura em 2x (retina): o recorte dobra', () => {
    const out = cropRectToPixels({ x: 100, y: 50, w: 800, h: 400 }, VIEW, { width: 2880, height: 1800 });
    expect(out).toEqual({ x: 200, y: 100, w: 1600, h: 800 });
  });

  it('captura em 1x mesmo com a tela dizendo 2x: o recorte NAO escorrega (bug de 06/10)', () => {
    // No teste no TradingView a captura veio 1440 de largura numa tela "2x":
    // usando o devicePixelRatio o recorte pegava a barra lateral e cortava o grafico.
    const out = cropRectToPixels({ x: 55, y: 70, w: 1035, h: 790 }, VIEW, { width: 1440, height: 900 });
    expect(out).toEqual({ x: 55, y: 70, w: 1035, h: 790 });
  });

  it('zoom do navegador: escala pela proporcao real entre captura e janela', () => {
    // Zoom 125% numa janela de 1440 px fisicos: a pagina ve 1152 px CSS.
    const out = cropRectToPixels({ x: 40, y: 40, w: 800, h: 500 }, { width: 1152, height: 720 }, { width: 1440, height: 900 });
    expect(out).toEqual({ x: 50, y: 50, w: 1000, h: 625 });
  });

  it('corta o que passa da borda da captura', () => {
    const out = cropRectToPixels({ x: -20, y: 700, w: 400, h: 300 }, { width: 1280, height: 800 }, { width: 1280, height: 800 });
    expect(out).toEqual({ x: 0, y: 700, w: 380, h: 100 });
  });

  it('arredonda para pixels inteiros', () => {
    const out = cropRectToPixels({ x: 10.4, y: 10.6, w: 100.2, h: 50.5 }, { width: 1000, height: 500 }, { width: 2000, height: 1000 })!;
    expect([out.x, out.y, out.w, out.h].every(Number.isInteger)).toBe(true);
  });

  it('retangulo fora da imagem ou janela invalida vira null (nada para mandar)', () => {
    expect(cropRectToPixels({ x: 2000, y: 0, w: 100, h: 100 }, { width: 1280, height: 800 }, { width: 1280, height: 800 })).toBeNull();
    expect(cropRectToPixels({ x: 0, y: 0, w: 100, h: 100 }, { width: 0, height: 800 }, { width: 1280, height: 800 })).toBeNull();
  });
});

describe('fitWithin', () => {
  it('reduz pelo lado maior, sem distorcer', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1000, 3000, 1600)).toEqual({ width: 533, height: 1600 });
  });

  it('nao aumenta imagem pequena', () => {
    expect(fitWithin(800, 400, 1600)).toEqual({ width: 800, height: 400 });
  });
});
