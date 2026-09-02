/**
 * TRAVA 2 — varre o FONTE e quebra o CI se alguma query publica deixar de
 * excluir analises com perfil de estrategia.
 *
 * Existe porque a separacao entre dado do motor e dado do usuario ja se perdeu
 * uma vez neste projeto (outcome vs userVerdict, 27/07) e custou uma sprint.
 * Mesmo padrao do route-access.spec.ts.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, 'ai.controller.ts'), 'utf8');

/** Toda query que alimenta numero ou vitrine publica. */
const PUBLIC_QUERY_MARKERS = [
  "recommendation: { not: null }, isDemo: false",
  "outcome: { in: [...AUTOMATIC_OUTCOMES] }, isDemo: false",
  "recommendation: { in: ['WAIT', 'HOLD', 'AGUARDAR'] }",
];

describe('TRAVA 2 — estrategia fora da amostra publica', () => {
  it('toda ocorrencia de isDemo: false numa query publica vem com strategyHash: null', () => {
    const wheres = SRC.split('where:').slice(1);
    const publicWheres = wheres.filter((w) => w.slice(0, 200).includes('isDemo: false'));
    expect(publicWheres.length).toBeGreaterThanOrEqual(4);
    for (const w of publicWheres) {
      expect(w.slice(0, 200)).toContain('strategyHash: null');
    }
  });

  it('os marcadores conhecidos das queries publicas continuam presentes', () => {
    // Se um destes sumir, a query foi reescrita e este teste precisa ser
    // revisto junto, em vez de ficar passando sobre codigo que nao existe mais.
    for (const marker of PUBLIC_QUERY_MARKERS) {
      expect(SRC).toContain(marker.split(', isDemo')[0]);
    }
  });
});
