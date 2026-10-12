import { ValidationPipe } from '@nestjs/common';
import { makeRawSqlPrisma as makePrisma } from '../../__tests__/raw-sql-mock';
import { MAX_TRACKING_SETUPS, SetupsService, readPlan, recordSetupVersion } from './setups.service';
import { FollowSetupDto, ListSetupsQueryDto, SetSetupStatusDto, SetupVersionsQueryDto } from './dto/setups.dto';
import { captureServer as captureServerMock } from '../../common/analytics/posthog';

jest.mock('../../common/analytics/posthog', () => ({
  ...jest.requireActual('../../common/analytics/posthog'),
  captureServer: jest.fn(),
}));
const captureServer = captureServerMock as jest.Mock;

const SETUP = {
  id: 'setup-aaaaaaaa',
  userId: 'u1',
  status: 'tracking',
  symbol: 'EURUSD',
  timeframe: '1H',
  rootAnalysisId: 'analysis00001',
  createdAt: new Date('2026-10-10T10:00:00Z'),
  lastAnalysisAt: new Date('2026-10-10T10:00:00Z'),
};

const WAIT_ROW = {
  id: 'analysis00001',
  status: 'completed',
  createdAt: new Date('2026-10-10T10:00:00Z'),
  recommendation: 'WAIT',
  result: { analysis: { symbol: 'EURUSD', timeframe: '1H', entry: 1.09, entryCondition: 'Close above 1.0950' } },
  setupId: null as string | null,
};

async function ready(prisma: any) {
  const service = new SetupsService(prisma);
  await service.onModuleInit();
  return service;
}

/** Nada de veredito, resultado, valor, favorito, nota ou exclusao: acompanhar nao e operar. */
function expectOnlySetupWrites(calls: Array<{ kind: string; text: string }>) {
  for (const call of calls) {
    expect(call.text).not.toMatch(/userVerdict|pnlPercent|pnlAmount|isFavorite|tradeNote|"outcome"|DELETE/i);
  }
}

describe('SetupsService', () => {
  beforeEach(() => captureServer.mockClear());

  it('seguir cria o setup da analise concluida da propria conta e vincula a raiz', async () => {
    const { prisma, calls } = makePrisma([
      ['FROM "tickrify"."Analysis"\n      WHERE "id"', () => [WAIT_ROW]],
      ['COUNT(*)::int AS "n"', () => [{ n: MAX_TRACKING_SETUPS - 1 }]],
      ['WHERE "rootAnalysisId"', () => []],
      ['WHERE "id" = ', () => [SETUP]],
    ]);
    const service = await ready(prisma);

    const { setup } = await service.follow({ id: 'u1', clerkUserId: 'clerk_1' }, 'analysis00001');

    expect(setup).toMatchObject({ id: SETUP.id, status: 'tracking', symbol: 'EURUSD', rootAnalysisId: 'analysis00001' });
    const insert = calls.find((c) => c.text.includes('INSERT INTO "tickrify"."TrackedSetup"'));
    expect(insert?.text).toContain('ON CONFLICT ("rootAnalysisId") DO NOTHING');
    expect(insert?.values).toEqual(expect.arrayContaining(['u1', 'analysis00001', 'EURUSD', '1H']));
    const link = calls.find((c) => c.text.includes('UPDATE "tickrify"."Analysis" SET "setupId"'));
    expect(link?.text).toContain('"setupId" IS NULL');
    expect(link?.values).toEqual(expect.arrayContaining(['analysis00001', 'u1']));
    // Lock por pessoa antes de contar o teto.
    expect(calls.findIndex((c) => c.text.includes('pg_advisory_xact_lock'))).toBeLessThan(
      calls.findIndex((c) => c.text.includes('COUNT(*)')),
    );
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_followed', {
      setupId: SETUP.id,
      rootAnalysisId: 'analysis00001',
      recommendation: 'WAIT',
      symbol: 'EURUSD',
      timeframe: '1H',
    });
    expectOnlySetupWrites(calls);
  });

  it('seguir duas vezes e um setup so (sem insert, sem evento)', async () => {
    const { prisma, calls } = makePrisma([
      ['FROM "tickrify"."Analysis"\n      WHERE "id"', () => [{ ...WAIT_ROW, setupId: SETUP.id }]],
      ['WHERE "id" = ', () => [SETUP]],
    ]);
    const service = await ready(prisma);

    const { setup } = await service.follow({ id: 'u1', clerkUserId: 'clerk_1' }, 'analysis00001');

    expect(setup.id).toBe(SETUP.id);
    expect(calls.some((c) => c.text.includes('INSERT'))).toBe(false);
    expect(calls.some((c) => c.kind === 'execute' && c.text.includes('UPDATE'))).toBe(false);
    expect(captureServer).not.toHaveBeenCalled();
  });

  it('analise de outra pessoa (ou em andamento) nao vira setup: 404', async () => {
    const { prisma, calls } = makePrisma([['FROM "tickrify"."Analysis"\n      WHERE "id"', () => []]]);
    const service = await ready(prisma);
    await expect(service.follow({ id: 'u2' }, 'analysis00001')).rejects.toMatchObject({ status: 404 });
    expect(calls.some((c) => c.kind === 'execute' && /INSERT|UPDATE/.test(c.text))).toBe(false);

    const running = makePrisma([['FROM "tickrify"."Analysis"\n      WHERE "id"', () => [{ ...WAIT_ROW, status: 'processing' }]]]);
    await expect((await ready(running.prisma)).follow({ id: 'u1' }, 'analysis00001')).rejects.toMatchObject({ status: 404 });
  });

  it(`teto de ${MAX_TRACKING_SETUPS}: o 21o pede para arquivar um, sem gravar`, async () => {
    const { prisma, calls } = makePrisma([
      ['FROM "tickrify"."Analysis"\n      WHERE "id"', () => [WAIT_ROW]],
      ['COUNT(*)::int AS "n"', () => [{ n: MAX_TRACKING_SETUPS }]],
    ]);
    const service = await ready(prisma);
    await expect(service.follow({ id: 'u1' }, 'analysis00001')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'setup_limit' }),
    });
    expect(calls.some((c) => c.text.includes('INSERT'))).toBe(false);
  });

  it('seguir de novo um setup largado volta a acompanhar (respeitando o teto)', async () => {
    const { prisma, calls } = makePrisma([
      ['FROM "tickrify"."Analysis"\n      WHERE "id"', () => [{ ...WAIT_ROW, setupId: SETUP.id }]],
      ['COUNT(*)::int AS "n"', () => [{ n: 3 }]],
      ['WHERE "id" = ', () => [{ ...SETUP, status: 'archived' }]],
    ]);
    const service = await ready(prisma);
    const { setup } = await service.follow({ id: 'u1', clerkUserId: 'clerk_1' }, 'analysis00001');
    expect(setup.status).toBe('tracking');
    expect(calls.find((c) => c.text.includes(`SET "status" = 'tracking'`))).toBeDefined();
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_followed', expect.objectContaining({ setupId: SETUP.id }));
  });

  it('largar e arquivar so mudam o status (nada e apagado) e emitem o evento sem texto', async () => {
    const { prisma, calls } = makePrisma([['WHERE "id" = ', () => [SETUP]]]);
    const service = await ready(prisma);

    await service.setStatus({ id: 'u1', clerkUserId: 'clerk_1' }, SETUP.id, 'archived');
    const update = calls.find((c) => c.text.includes('UPDATE "tickrify"."TrackedSetup"'));
    expect(update?.values).toEqual(expect.arrayContaining(['archived', SETUP.id, 'u1']));
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_archived', { setupId: SETUP.id });

    await service.setStatus({ id: 'u1', clerkUserId: 'clerk_1' }, SETUP.id, 'untracked');
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'setup_unfollowed', { setupId: SETUP.id });
    expectOnlySetupWrites(calls);
  });

  it('setup de outra pessoa: 404 em ler, mudar status e atualizar', async () => {
    const { prisma, calls } = makePrisma([['WHERE "id" = ', (_t, values) => (values.includes('u1') ? [SETUP] : [])]]);
    const service = await ready(prisma);

    await expect(service.get('u2', SETUP.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.setStatus({ id: 'u2' }, SETUP.id, 'archived')).rejects.toMatchObject({ status: 404 });
    await expect(service.assertUpdatable('u2', SETUP.id)).rejects.toMatchObject({ status: 404 });
    expect(calls.some((c) => c.kind === 'execute' && c.text.includes('UPDATE'))).toBe(false);
  });

  it('setup arquivado ou largado nao recebe atualizacao: 409', async () => {
    const { prisma } = makePrisma([['WHERE "id" = ', () => [{ ...SETUP, status: 'archived' }]]]);
    const service = await ready(prisma);
    await expect(service.assertUpdatable('u1', SETUP.id)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'setup_not_tracking' }),
    });
  });

  it('vincular so grava se o setup e da pessoa e esta sendo acompanhado', async () => {
    const { prisma, calls } = makePrisma([]);
    const service = await ready(prisma);
    await service.linkAnalysis('u1', 'analysis00002', SETUP.id);
    const link = calls.find((c) => c.text.includes('UPDATE "tickrify"."Analysis" SET "setupId"'));
    expect(link?.text).toContain(`s."userId" = ? AND s."status" = 'tracking'`);
    expect(link?.values).toEqual([SETUP.id, 'analysis00002', 'u1', SETUP.id, 'u1']);
  });

  it('versoes: mais nova primeiro, numeradas pela ordem real, precos so em BUY/SELL', async () => {
    const { prisma, calls } = makePrisma([
      ['WHERE "id" = ', () => [SETUP]],
      [
        'ROW_NUMBER()',
        () => [
          {
            id: 'analysis00002',
            createdAt: new Date('2026-10-11T09:00:00Z'),
            recommendation: 'BUY',
            version: 2,
            result: { analysis: { entry: 1.0952, stopLoss: 1.0921, takeProfit1: 1.0998, takeProfit2: 1.103, entryCondition: 'x' } },
          },
          { ...WAIT_ROW, version: 1 },
        ],
      ],
    ]);
    const service = await ready(prisma);
    const page = await service.get('u1', SETUP.id);

    expect(page.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(page.versions[0]).toMatchObject({ recommendation: 'BUY', entry: 1.0952, stopLoss: 1.0921, entryCondition: null });
    expect(page.versions[1]).toMatchObject({ recommendation: 'WAIT', entry: null, entryCondition: 'Close above 1.0950' });
    const query = calls.find((c) => c.text.includes('ROW_NUMBER()'));
    expect(query?.text).toContain(`a."status" = 'completed'`);
    expect(query?.text).toContain('ORDER BY v."createdAt" DESC, v."id" DESC');
  });

  it('gratis esgotado: so as versoes entre as analises abertas; nenhuma aberta = lista vazia sem consulta', async () => {
    const { prisma, calls } = makePrisma([['WHERE "id" = ', () => [SETUP]]]);
    const service = await ready(prisma);
    await service.get('u1', SETUP.id, { readableIds: ['analysis00001'] });
    const query = calls.find((c) => c.text.includes('ROW_NUMBER()'));
    expect(query?.text).toContain('AND v."id" IN');
    expect(query?.values).toContain('analysis00001');

    const empty = makePrisma([['WHERE "id" = ', () => [SETUP]]]);
    const result = await (await ready(empty.prisma)).get('u1', SETUP.id, { readableIds: [] });
    expect(result.versions).toEqual([]);
    expect(empty.calls.some((c) => c.text.includes('ROW_NUMBER()'))).toBe(false);
  });

  it('cursor de versao que nao e deste setup da pessoa encerra a lista', async () => {
    const { prisma, calls } = makePrisma([
      ['WHERE "id" = ', (text) => (text.includes('TrackedSetup') ? [SETUP] : [])],
    ]);
    const service = await ready(prisma);
    const page = await service.get('u1', SETUP.id, { cursor: 'analysisXXXXX' });
    expect(page.versions).toEqual([]);
    expect(calls.some((c) => c.text.includes('ROW_NUMBER()'))).toBe(false);
  });

  it('lista so os acompanhados da pessoa, com a ultima versao e a condicao de espera', async () => {
    const { prisma, calls } = makePrisma([
      [
        'LEFT JOIN LATERAL',
        () => [
          {
            ...SETUP,
            versions: 2,
            firstAnalysisAt: new Date('2026-10-08T10:00:00Z'),
            latestAnalysisId: 'analysis00002',
            latestAt: new Date('2026-10-11T09:00:00Z'),
            latestRecommendation: 'WAIT',
            latestResult: { analysis: { entryCondition: 'Retest of 1.0950 holds' } },
          },
        ],
      ],
    ]);
    const service = await ready(prisma);
    const { items, nextCursor } = await service.list('u1', null, 20);

    expect(items[0]).toMatchObject({
      id: SETUP.id,
      firstAnalysisAt: new Date('2026-10-08T10:00:00Z'),
      versions: 2,
      latest: { analysisId: 'analysis00002', recommendation: 'WAIT', entryCondition: 'Retest of 1.0950 holds' },
    });
    expect(nextCursor).toBeNull();
    const query = calls.find((c) => c.text.includes('LEFT JOIN LATERAL'));
    expect(query?.text).toContain(`s."status" = 'tracking'`);
    expect(query?.values).toContain('u1');
  });

  it('sem a tabela no boot: tudo responde 503 e nada e gravado', async () => {
    const { prisma, calls } = makePrisma([]);
    prisma.$executeRawUnsafe.mockRejectedValue(new Error('permission denied'));
    const service = await ready(prisma);
    await expect(service.follow({ id: 'u1' }, 'analysis00001')).rejects.toMatchObject({ status: 503 });
    await expect(service.assertUpdatable('u1', SETUP.id)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });

  it('readPlan: WAIT sem entryCondition usa o cenario alternativo (onde o motor as vezes poe o gatilho)', () => {
    const result = { analysis: { entryCondition: null, alternativeScenario: 'If price closes above 82,000, reassess for BUY toward 82,400.' } };
    expect(readPlan(result, 'WAIT').entryCondition).toBe('If price closes above 82,000, reassess for BUY toward 82,400.');
    expect(readPlan({ analysis: { entryCondition: 'Close above 1.0950', alternativeScenario: 'x' } }, 'WAIT').entryCondition).toBe('Close above 1.0950');
    expect(readPlan({ analysis: { alternativeScenario: 'x', entry: 1 } }, 'BUY').entryCondition).toBeNull();
  });

  it('readPlan: WAIT nunca devolve precos; simbolo vazio vira null', () => {
    expect(readPlan(WAIT_ROW.result, 'WAIT')).toMatchObject({ entry: null, entryCondition: 'Close above 1.0950', symbol: 'EURUSD' });
    expect(readPlan({ analysis: { entry: 0, takeProfit1: -1 } }, 'BUY')).toMatchObject({ entry: null, takeProfit1: null, symbol: null });
  });
});

describe('recordSetupVersion (fila e caminho sincrono)', () => {
  beforeEach(() => captureServer.mockClear());

  const versions = [
    { id: 'analysis00001', createdAt: new Date('2026-10-10T10:00:00Z'), recommendation: 'WAIT' },
    { id: 'analysis00002', createdAt: new Date('2026-10-11T10:00:00Z'), recommendation: 'WAIT' },
    { id: 'analysis00003', createdAt: new Date('2026-10-13T22:00:00Z'), recommendation: 'BUY' },
  ];

  it('atualizacao: ultima analise e evento so com ids, numeros e enums', async () => {
    const { prisma, calls } = makePrisma([['ORDER BY a."createdAt" ASC', () => versions]]);
    await recordSetupVersion(prisma, {
      analysisId: 'analysis00003', userId: 'u1', setupId: SETUP.id, analysisType: 'deep', isDemo: false,
    });

    const update = calls.find((c) => c.text.includes('UPDATE "tickrify"."TrackedSetup"'));
    expect(update?.values).toEqual([versions[2].createdAt, SETUP.id, 'u1']);
    expect(captureServer).toHaveBeenCalledWith(
      'clerk_1',
      'setup_update_completed',
      {
        setupId: SETUP.id,
        analysisId: 'analysis00003',
        version: 3,
        daysSinceRoot: 3.5,
        daysSinceLast: 2.5,
        analysisType: 'deep',
        ticksCost: 3,
        recommendation: 'BUY',
      },
      expect.anything(),
    );
  });

  it('gratis custa 0 ticks; a raiz nao conta como atualizacao', async () => {
    const { prisma } = makePrisma([['ORDER BY a."createdAt" ASC', () => versions]]);
    await recordSetupVersion(prisma, { analysisId: 'analysis00002', userId: 'u1', setupId: SETUP.id, analysisType: 'quick', isDemo: true });
    expect(captureServer).toHaveBeenLastCalledWith('clerk_1', 'setup_update_completed', expect.objectContaining({ ticksCost: 0, version: 2 }), expect.anything());

    captureServer.mockClear();
    await recordSetupVersion(prisma, { analysisId: 'analysis00001', userId: 'u1', setupId: SETUP.id, analysisType: 'quick', isDemo: true });
    expect(captureServer).not.toHaveBeenCalled();
  });

  it('nunca lanca: falha de banco so vira log', async () => {
    const log = jest.fn();
    const prisma: any = { $queryRaw: jest.fn().mockRejectedValue(new Error('column "setupId" does not exist')) };
    await expect(
      recordSetupVersion(prisma, { analysisId: 'a', userId: 'u1', setupId: 's', analysisType: 'quick', isDemo: true }, log),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[setups]'));
  });
});

describe('DTOs de setups contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const body = (metatype: any) => ({ type: 'body' as const, metatype });
  const query = (metatype: any) => ({ type: 'query' as const, metatype });

  it('seguir: so o id da analise, sem campo extra', async () => {
    await expect(pipe.transform({ analysisId: 'cmg1abcdef0123456789' }, body(FollowSetupDto))).resolves.toBeDefined();
    await expect(pipe.transform({ analysisId: 'x' }, body(FollowSetupDto))).rejects.toBeDefined();
    await expect(pipe.transform({ analysisId: '<script>' }, body(FollowSetupDto))).rejects.toBeDefined();
    await expect(pipe.transform({ analysisId: 'cmg1abcdef0123456789', userId: 'u2' }, body(FollowSetupDto))).rejects.toBeDefined();
  });

  it('status: so largar ou arquivar (voltar a seguir e pelo POST)', async () => {
    await expect(pipe.transform({ status: 'archived' }, body(SetSetupStatusDto))).resolves.toBeDefined();
    await expect(pipe.transform({ status: 'untracked' }, body(SetSetupStatusDto))).resolves.toBeDefined();
    await expect(pipe.transform({ status: 'tracking' }, body(SetSetupStatusDto))).rejects.toBeDefined();
    await expect(pipe.transform({ status: 'deleted' }, body(SetSetupStatusDto))).rejects.toBeDefined();
  });

  it('paginacao: limite numerico e cursor estreito', async () => {
    await expect(pipe.transform({ limit: '10', cursor: 'setup-aaaaaaaa' }, query(ListSetupsQueryDto))).resolves.toMatchObject({ limit: 10 });
    await expect(pipe.transform({ limit: '500' }, query(ListSetupsQueryDto))).rejects.toBeDefined();
    await expect(pipe.transform({ cursor: "x' OR 1=1" }, query(SetupVersionsQueryDto))).rejects.toBeDefined();
  });
});
