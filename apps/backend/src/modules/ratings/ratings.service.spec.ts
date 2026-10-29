import { ValidationPipe } from '@nestjs/common';
import { RatingsAdminController } from './ratings-admin.controller';
import { RatingsController } from './ratings.controller';
import { AuthGuard } from '../auth/auth.guard';
import { captureServer } from '../../common/analytics/posthog';
jest.mock('../../common/analytics/posthog', () => ({ captureServer: jest.fn() }));

import { RatingsService } from './ratings.service';
import { CreateRatingDto, CreateUsefulnessDto, PublishRatingDto, UpdateRatingDto } from './dto/ratings.dto';

function makeService() {
  const prisma: any = {
    $executeRawUnsafe: jest.fn(async () => 0),
    $queryRawUnsafe: jest.fn(async () => []),
    analysis: { findFirst: jest.fn(async () => ({ recommendation: 'BUY' })) },
    analysisRating: {
      create: jest.fn(async () => ({ id: 'cmrating12345', createdAt: new Date('2026-10-28T12:00:00Z') })),
      upsert: jest.fn(async () => ({ id: 'rating_1' })),
      findFirst: jest.fn(async () => ({ id: 'rating_1' })),
      findUnique: jest.fn(async () => ({ quoteConsent: true, comment: 'Great tool' })),
      update: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      groupBy: jest.fn(async () => []),
    },
    user: { findMany: jest.fn(async () => []) },
  };
  return { service: new RatingsService(prisma), prisma };
}

describe('RatingsService', () => {
  it('so da nota a analise concluida da propria conta, fora da demo', async () => {
    const { service, prisma } = makeService();
    await service.onModuleInit();
    await service.rate({ id: 'u1' }, 'analysis_123', 5);
    expect(prisma.analysis.findFirst).toHaveBeenCalledWith({
      where: { id: 'analysis_123', userId: 'u1', status: 'completed', isDemo: false },
      select: { recommendation: true },
    });
    expect(prisma.analysisRating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ rating: 5, recommendation: 'BUY' }), update: { rating: 5 } }),
    );

    prisma.analysis.findFirst.mockResolvedValue(null);
    await expect(service.rate({ id: 'u2' }, 'analysis_123', 5)).rejects.toMatchObject({ status: 404 });
  });

  it('licenca sem comentario nao vale; retirar a licenca tira do site', async () => {
    const { service, prisma } = makeService();
    await service.onModuleInit();
    await service.addDetails({ id: 'u1' }, 'rating_1', { quoteConsent: true, comment: '   ' });
    expect(prisma.analysisRating.update).toHaveBeenLastCalledWith({
      where: { id: 'rating_1' },
      data: expect.objectContaining({ quoteConsent: false, comment: null }),
    });

    await service.addDetails({ id: 'u1' }, 'rating_1', { quoteConsent: false, comment: 'ok' });
    expect(prisma.analysisRating.update).toHaveBeenLastCalledWith({
      where: { id: 'rating_1' },
      data: expect.objectContaining({ quoteConsent: false, published: false }),
    });
  });

  it('nota de outra pessoa nao pode ser editada', async () => {
    const { service, prisma } = makeService();
    await service.onModuleInit();
    prisma.analysisRating.findFirst.mockResolvedValue(null);
    await expect(service.addDetails({ id: 'u2' }, 'rating_1', { comment: 'x' })).rejects.toMatchObject({ status: 404 });
    expect(prisma.analysisRating.update).not.toHaveBeenCalled();
  });

  it('site so recebe publicado, com licenca, nota 4+ e comentario', async () => {
    const { service, prisma } = makeService();
    await service.onModuleInit();
    prisma.analysisRating.findMany.mockResolvedValue([{ comment: 'Keeps me disciplined', displayName: 'Mattia', country: 'Italy' }]);
    await expect(service.testimonials()).resolves.toEqual([{ comment: 'Keeps me disciplined', displayName: 'Mattia', country: 'Italy' }]);
    expect(prisma.analysisRating.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ published: true, quoteConsent: true, rating: { gte: 4 }, comment: { not: null }, OR: expect.any(Array) }) }),
    );
  });

  it('admin nao publica sem licenca', async () => {
    const { service, prisma } = makeService();
    await service.onModuleInit();
    prisma.analysisRating.findUnique.mockResolvedValue({ quoteConsent: false, comment: 'Nice' });
    await expect(service.adminPublish('rating_1', { published: true })).rejects.toMatchObject({ status: 400 });
    await expect(service.adminPublish('rating_1', { published: false })).resolves.toEqual({ id: 'rating_1', published: false });
  });
});

describe('DTOs das notas contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const meta = (metatype: any) => ({ type: 'body' as const, metatype });

  it('estrela: 1 a 5 e id de analise', async () => {
    await expect(pipe.transform({ analysisId: 'cmabc1234567', rating: 5 }, meta(CreateRatingDto))).resolves.toBeDefined();
    await expect(pipe.transform({ analysisId: 'cmabc1234567', rating: 6 }, meta(CreateRatingDto))).rejects.toBeDefined();
    await expect(pipe.transform({ analysisId: '../x', rating: 3 }, meta(CreateRatingDto))).rejects.toBeDefined();
  });

  it('detalhes: motivos so da lista e texto com teto', async () => {
    await expect(pipe.transform({ reasons: ['too_many_waits'], comment: 'x', quoteConsent: false }, meta(UpdateRatingDto))).resolves.toBeDefined();
    await expect(pipe.transform({ reasons: ['free text'] }, meta(UpdateRatingDto))).rejects.toBeDefined();
    await expect(pipe.transform({ comment: 'x'.repeat(501) }, meta(UpdateRatingDto))).rejects.toBeDefined();
    await expect(pipe.transform({ published: true }, meta(UpdateRatingDto))).rejects.toBeDefined();
  });

  it('publicar: so booleano e rotulos curtos', async () => {
    await expect(pipe.transform({ published: true, displayName: 'Mattia', country: 'Italy' }, meta(PublishRatingDto))).resolves.toBeDefined();
    await expect(pipe.transform({ published: 'yes' }, meta(PublishRatingDto))).rejects.toBeDefined();
  });
});


describe('usefulness of owned authenticated analyses', () => {
  const createdAt = new Date('2026-10-28T10:00:00Z');
  async function setup(isDemo = true, recommendation = 'BUY', signalState = 'ENTER_NOW') {
    jest.clearAllMocks();
    const ctx = makeService();
    await ctx.service.onModuleInit();
    ctx.prisma.analysis.findFirst.mockResolvedValue({ isDemo, recommendation, result: { signalState }, createdAt });
    ctx.prisma.analysisRating.findUnique.mockResolvedValue(null);
    ctx.prisma.analysisRating.findFirst.mockResolvedValue(null);
    return ctx;
  }

  it.each([['BUY', 'ENTER_NOW', 'BUY'], ['SELL', 'ARMED', 'SELL'], ['WAIT', 'WATCH', 'WATCH'], ['WAIT', 'NO_TRADE', 'NO_TRADE']])('records %s/%s without changing the decision', async (recommendation, signalState, verdict) => {
    const { service, prisma } = await setup(true, recommendation, signalState);
    await service.usefulness({ id: 'u1', clerkUserId: 'clerk1' }, 'cmanalysis123', false);
    expect(prisma.analysis.findFirst).toHaveBeenCalledWith({ where: { id: 'cmanalysis123', userId: 'u1', status: 'completed' }, select: { isDemo: true, recommendation: true, result: true, createdAt: true } });
    expect(prisma.analysisRating.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'u1', analysisId: 'cmanalysis123', rating: 1, recommendation, reasons: { kind: 'usefulness', version: 1, useful: false, modality: 'legacy', verdict, reasons: [] } }) }));
    expect(captureServer).toHaveBeenCalledWith('clerk1', 'analysis_usefulness_answered', { analysisId: 'cmanalysis123', useful: false, modality: 'legacy', verdict }, expect.objectContaining({ dedupeKey: 'usefulness:cmrating12345' }));
  });

  it('classifies trial by saved analysis time; pre-trial stays legacy; paid stays paid', async () => {
    const { service, prisma } = await setup();
    prisma.$queryRawUnsafe.mockResolvedValue([{ startedAt: new Date('2026-10-27') }]);
    expect(await service.usefulnessEligibility('u1', 'cmanalysis123')).toMatchObject({ eligible: true, modality: 'trial' });
    prisma.$queryRawUnsafe.mockResolvedValue([{ startedAt: new Date('2026-10-29') }]);
    expect(await service.usefulnessEligibility('u1', 'cmanalysis123')).toMatchObject({ modality: 'legacy' });
    prisma.analysis.findFirst.mockResolvedValue({ isDemo: false, recommendation: 'BUY', result: {}, createdAt });
    expect(await service.usefulnessEligibility('u1', 'cmanalysis123')).toMatchObject({ eligible: false, modality: 'paid' });
    await service.usefulness({ id: 'u1' }, 'cmanalysis123', true);
    expect(prisma.analysisRating.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ reasons: expect.objectContaining({ modality: 'paid', useful: true }) }) }));
  });

  it('suppresses already rated analyses and the 30-day answer cooldown across devices', async () => {
    const { service, prisma } = await setup();
    prisma.analysisRating.findUnique.mockResolvedValue({ id: 'existing' });
    expect(await service.usefulnessEligibility('u1', 'cmanalysis123')).toMatchObject({ eligible: false });
    expect(await service.usefulness({ id: 'u1', clerkUserId: 'clerk1' }, 'cmanalysis123', true)).toEqual({ id: 'existing', duplicate: true });
    expect(prisma.analysisRating.create).not.toHaveBeenCalled();
    expect(captureServer).not.toHaveBeenCalled();
    prisma.analysisRating.findUnique.mockResolvedValue(null);
    prisma.analysisRating.findFirst.mockResolvedValue({ id: 'recent' });
    expect(await service.usefulnessEligibility('u1', 'cmanalysis123')).toMatchObject({ eligible: false });
  });

  it('duplicate race returns the original row without another answer event', async () => {
    const { service, prisma } = await setup();
    prisma.analysisRating.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner' });
    prisma.analysisRating.create.mockRejectedValueOnce({ code: 'P2002' });
    expect(await service.usefulness({ id: 'u1', clerkUserId: 'clerk1' }, 'cmanalysis123', false)).toEqual({ id: 'winner', duplicate: true });
    expect(captureServer).not.toHaveBeenCalled();
  });

  it('rejects foreign, unfinished or missing analyses in both endpoints', async () => {
    const { service, prisma } = await setup();
    prisma.analysis.findFirst.mockResolvedValue(null);
    await expect(service.usefulness({ id: 'attacker' }, 'cmanalysis123', true)).rejects.toMatchObject({ status: 404 });
    await expect(service.usefulnessEligibility('attacker', 'cmanalysis123')).rejects.toMatchObject({ status: 404 });
    expect(prisma.analysisRating.create).not.toHaveBeenCalled();
  });

  it('stores optional reasons in the existing JSON without consent, comments, or rewriting analysis', async () => {
    const { service, prisma } = await setup();
    const data = { kind: 'usefulness', version: 1, useful: false, modality: 'trial', verdict: 'WATCH', reasons: [] };
    prisma.analysisRating.findFirst.mockResolvedValue({ id: 'cmrating12345', reasons: data });
    prisma.analysisRating.update.mockResolvedValue({ analysisId: 'cmanalysis123', updatedAt: createdAt });
    await service.addDetails({ id: 'u1', clerkUserId: 'clerk1' }, 'cmrating12345', { reasons: ['next_step_unclear', 'not_trusted', 'next_step_unclear'] });
    expect(prisma.analysisRating.update).toHaveBeenCalledWith({ where: { id: 'cmrating12345' }, data: { reasons: { ...data, reasons: ['next_step_unclear', 'not_trusted'] } }, select: { analysisId: true, updatedAt: true } });
    await expect(service.addDetails({ id: 'u1' }, 'cmrating12345', { quoteConsent: true })).rejects.toMatchObject({ status: 400 });
    await expect(service.addDetails({ id: 'u1' }, 'cmrating12345', { reasons: ['too_many_waits'] })).rejects.toMatchObject({ status: 400 });
    prisma.analysisRating.findFirst.mockResolvedValue(null);
    await expect(service.addDetails({ id: 'other' }, 'cmrating12345', { reasons: [] })).rejects.toMatchObject({ status: 404 });
  });

  it('all feedback routes require authentication, not a paid subscription', async () => {
    for (const method of ['eligibility', 'usefulness', 'details'] as const) expect(Reflect.getMetadata('__guards__', RatingsController.prototype[method])).toContain(AuthGuard);
    const guard = new AuthGuard({} as any, {} as any);
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as any)).rejects.toMatchObject({ status: 401 });
    const controller = new RatingsController({} as any);
    expect(() => controller.usefulness({ clerkUserId: 'x' }, { analysisId: 'cmanalysis123', useful: true })).toThrow();
  });

  it('admin receives normalized reason arrays and separate binary data, without mixing star averages', async () => {
    const { service, prisma } = await setup();
    const feedback = { kind: 'usefulness', version: 1, useful: false, modality: 'trial', verdict: 'NO_TRADE', reasons: ['not_trusted'] };
    prisma.analysisRating.findMany.mockResolvedValue([{ id: 'r1', userId: 'u1', rating: 1, reasons: feedback }]);
    const report = await service.adminList(true);
    expect(report.items[0]).toMatchObject({ reasons: ['not_trusted'], feedback });
    expect(prisma.analysisRating.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }));
  });

  it('old admin clients receive only stars; new clients explicitly opt in; all averages exclude binary objects', async () => {
    const { service, prisma } = await setup();
    await service.adminList();
    expect(prisma.analysisRating.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { OR: [
      { reasons: { equals: expect.anything() } }, { reasons: { equals: expect.anything() } }, { reasons: { array_contains: [] } },
    ] } }));
    await service.adminList(true);
    expect(prisma.analysisRating.findMany).toHaveBeenLastCalledWith({ orderBy: { createdAt: 'desc' }, take: 100 });
    const avgFilter = prisma.analysisRating.groupBy.mock.calls[0][0].where;
    expect(avgFilter.OR).toHaveLength(3);
    const list = jest.fn(); const controller = new RatingsAdminController({ adminList: list } as any);
    controller.list(); controller.list('true'); controller.list('false');
    expect(list.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('unknown trial lookup stays generic free; historical trial stays trial after conversion; paid never consults current plan', async () => {
    const { service, prisma } = await setup();
    prisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('database read unavailable'));
    expect(await service.usefulnessEligibility('u1', 'cmanalysis123')).toMatchObject({ modality: 'free' });
    prisma.$queryRawUnsafe.mockResolvedValue([{ startedAt: new Date('2026-10-27'), status: 'ended_converted' }]);
    expect(await service.usefulnessEligibility('u1', 'cmanalysis123')).toMatchObject({ modality: 'trial' });
    await service.usefulness({ id: 'u1' }, 'cmanalysis123', false);
    expect(prisma.analysisRating.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reasons: expect.objectContaining({ modality: 'trial' }) }) }));
    prisma.analysis.findFirst.mockResolvedValue({ isDemo: false, recommendation: 'BUY', result: {}, createdAt });
    prisma.$queryRawUnsafe.mockClear();
    expect(await service.usefulnessEligibility('u1', 'cmanalysis123')).toMatchObject({ modality: 'paid' });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('binary feedback can never become a testimonial or be applied to a star row', async () => {
    const { service, prisma } = await setup();
    prisma.analysisRating.findUnique.mockResolvedValue({ quoteConsent: true, comment: 'unexpected', reasons: { kind: 'usefulness', version: 1, useful: true } });
    await expect(service.adminPublish('cmrating12345', { published: true })).rejects.toMatchObject({ status: 400 });
    prisma.analysisRating.findFirst.mockResolvedValue({ id: 'cmrating12345', reasons: ['other'] });
    await expect(service.addDetails({ id: 'u1' }, 'cmrating12345', { reasons: ['other'], kind: 'usefulness' })).rejects.toMatchObject({ status: 400 });
  });

  it('validates binary response and closed reasons without accepting spoofed account data', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
    const meta = { type: 'body' as const, metatype: CreateUsefulnessDto };
    await expect(pipe.transform({ analysisId: 'cmanalysis123', useful: true }, meta)).resolves.toBeDefined();
    for (const body of [{ analysisId: 'cmanalysis123', useful: 'yes' }, { analysisId: '../x', useful: true }, { analysisId: 'cmanalysis123', useful: false, userId: 'spoof', modality: 'trial' }]) await expect(pipe.transform(body, meta)).rejects.toBeDefined();
  });
});
