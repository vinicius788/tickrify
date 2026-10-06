import { describe, expect, it } from 'vitest';
import { isTranslatorOnlyError } from '@/lib/utils';

// Pilha real do Sentry de 06/10/2026 (Chrome do iPhone traduzindo o painel).
const tradutor = [
  { filename: 'https://tickrify.com/dashboard/analysis/cmux0235h0003gs072arlt06i' },
  { filename: 'https://tickrify.com/' },
];

describe('ruido do tradutor no Sentry', () => {
  it('pagina traduzida e nenhuma linha do nosso bundle: descarta', () => {
    expect(isTranslatorOnlyError(true, tradutor)).toBe(true);
  });

  it('qualquer linha do bundle (/assets/) mantem o erro: pode ser nosso', () => {
    expect(isTranslatorOnlyError(true, [...tradutor, { filename: 'https://tickrify.com/assets/index-abc.js' }])).toBe(false);
  });

  it('pagina sem traducao ou erro sem pilha nunca e descartado', () => {
    expect(isTranslatorOnlyError(false, tradutor)).toBe(false);
    expect(isTranslatorOnlyError(true, [])).toBe(false);
    expect(isTranslatorOnlyError(true, undefined)).toBe(false);
  });
});
