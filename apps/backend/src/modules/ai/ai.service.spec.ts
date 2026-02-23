import { HttpException, HttpStatus } from '@nestjs/common';
import { AiService } from './ai.service';

describe('AiService access enforcement', () => {
  let service: AiService;
  let prisma: any;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.FREE_ANALYSIS_LIMIT_PER_MONTH = '3';

    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'usr_1' }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      analysis: {
        create: jest.fn(),
        update: jest.fn(),
      },
      promptConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const aiAdapter = {
      analyzeImage: jest.fn(),
    };

    service = new AiService(prisma, aiAdapter as any);
  });

  it('blocks analysis creation when free quota is exhausted', async () => {
    try {
      await service.createAnalysis('usr_1', undefined, 'data:image/png;base64,AAAA');
      throw new Error('Expected quota_exceeded exception');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpError = error as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(httpError.getResponse()).toEqual(
        expect.objectContaining({
          code: 'quota_exceeded',
        }),
      );
    }
  });
});
