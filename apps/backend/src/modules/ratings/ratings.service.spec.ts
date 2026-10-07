import { ValidationPipe } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { CreateRatingDto, PublishRatingDto, UpdateRatingDto } from './dto/ratings.dto';

function makeService() {
  const prisma: any = {
    $executeRawUnsafe: jest.fn(async () => 0),
    analysis: { findFirst: jest.fn(async () => ({ recommendation: 'BUY' })) },
    analysisRating: {
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
      expect.objectContaining({ where: { published: true, quoteConsent: true, rating: { gte: 4 }, comment: { not: null } } }),
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
