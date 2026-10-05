import { buildAcquisitionReport, parseDias } from './acquisition-report';

describe('aba Origem do /admin', () => {
  it('so aceita os periodos da tela; 0 e desde o inicio; o resto vira 30', () => {
    expect(parseDias('7')).toBe(7);
    expect(parseDias('90')).toBe(90);
    expect(parseDias('0')).toBeNull();
    expect(parseDias('365')).toBe(30);
    expect(parseDias(undefined)).toBe(30);
    expect(parseDias('1; drop table')).toBe(30);
  });

  it('declarada, tecnica e respostas, sempre sem acesso manual e sem admin', async () => {
    const textos: string[] = [];
    const valores: unknown[][] = [];
    const prisma = {
      $queryRaw: jest.fn(async (q: { text: string; values: unknown[] }) => {
        textos.push(q.text);
        valores.push(q.values);
        return [];
      }),
    };
    const out = await buildAcquisitionReport(prisma as any, 30);

    expect(out).toEqual({ dias: 30, declarada: [], tecnica: [], respostas: [] });
    expect(textos).toHaveLength(3);
    for (const t of textos) {
      expect(t).toContain(`NOT LIKE 'manual_%'`);
      expect(t).toContain(`<> 'admin'`);
    }
    expect(textos[0]).toContain('declarada AS canal');
    expect(textos[1]).toContain('tecnica AS canal');
    // O periodo vai como parametro, nunca colado no SQL.
    expect(valores.every((v) => v.includes(30))).toBe(true);
  });

  it('desde o inicio: sem filtro de data', async () => {
    const prisma = { $queryRaw: jest.fn(async () => []) };
    await buildAcquisitionReport(prisma as any, null);
    for (const [q] of prisma.$queryRaw.mock.calls as unknown as Array<[{ text: string }]>) {
      expect(q.text).not.toContain('make_interval');
    }
  });
});
