import { ValidationPipe } from '@nestjs/common';
import { FeedbackService, cleanFeedback, isMeaningfulFeedback } from './feedback.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { FEEDBACK_RULES } from '../../common/feedback-bonus';

jest.mock('../../common/analytics/posthog', () => ({ captureServer: jest.fn() }));
import { captureServer } from '../../common/analytics/posthog';

const GOOD = 'The levels are clear and the wait call saved me a trade.';

function build(opts: { paid?: boolean; taken?: boolean; trialStatus?: string | null } = {}) {
  const inserts: unknown[][] = [];
  const prisma = {
    $executeRawUnsafe: jest.fn(async () => 0),
    $queryRawUnsafe: jest.fn(async (sql: string, ...values: unknown[]) => {
      if (sql.includes('to_regclass')) return [{ ok: true }];
      if (sql.includes('FROM "tickrify"."UserTrial"')) {
        return opts.trialStatus ? [{ userId: 'u1', startedAt: new Date(), status: opts.trialStatus, usageDays: [] }] : [];
      }
      if (sql.includes('INSERT INTO "tickrify"."UserFeedback"')) {
        if (opts.taken) return [];
        inserts.push(values);
        return [{ id: values[0] }];
      }
      return [];
    }),
  };
  const ai = { hasPaidAccess: jest.fn(async () => opts.paid === true) };
  const service = new FeedbackService(prisma as never, ai as never);
  return { service, prisma, inserts };
}

const submit = (service: FeedbackService, message = GOOD) =>
  service.submit({ id: 'u1', clerkUserId: 'clerk_1' }, { message, source: 'limit' });

describe('FeedbackService (opiniao que vale analises)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('grava a opiniao com o credito na mesma linha e emite o evento sem o texto', async () => {
    const { service, inserts } = build();
    await service.onModuleInit();
    await expect(submit(service, `  ${GOOD}  `)).resolves.toEqual({ bonusAnalyses: FEEDBACK_RULES.bonusAnalyses });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].slice(1)).toEqual(['u1', GOOD, 'limit', FEEDBACK_RULES.bonusAnalyses]);
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'feedback_submitted', { source: 'limit', length: GOOD.length, bonus_analyses: 3 });
  });

  it('segunda opiniao da mesma conta recebe 409 e nao emite evento', async () => {
    const { service } = build({ taken: true });
    await service.onModuleInit();
    await expect(submit(service)).rejects.toMatchObject({ response: { code: 'feedback_already_used' } });
    expect(captureServer).not.toHaveBeenCalled();
  });

  it.each([
    ['assinante', { paid: true }, 'feedback_subscriber'],
    ['trial negado', { trialStatus: 'denied' }, 'feedback_not_eligible'],
  ])('%s nao grava nada', async (_name, opts, expected) => {
    const { service, inserts } = build(opts);
    await service.onModuleInit();
    await expect(submit(service)).rejects.toMatchObject({ response: { code: expected } });
    expect(inserts).toHaveLength(0);
  });

  it.each([['too short'], ['a'.repeat(40)], ['x'.repeat(501) + GOOD]])('texto invalido (%s) e recusado antes de qualquer consulta de acesso', async (message) => {
    const { service, inserts } = build();
    await service.onModuleInit();
    await expect(submit(service, message)).rejects.toMatchObject({ response: { code: 'feedback_invalid' } });
    expect(inserts).toHaveLength(0);
  });

  it('sem a tabela no boot, responde indisponivel', async () => {
    const { service, prisma } = build();
    prisma.$executeRawUnsafe.mockRejectedValueOnce(new Error('boom'));
    await service.onModuleInit();
    await expect(submit(service)).rejects.toMatchObject({ response: { code: 'feedback_unavailable' } });
  });

  it('limpeza e minimo de letras diferentes', () => {
    expect(cleanFeedback('  a \n b  ')).toBe('a b');
    expect(isMeaningfulFeedback('aaaa bbbb aaaa bbbb')).toBe(false);
    expect(isMeaningfulFeedback(GOOD)).toBe(true);
  });
});

describe('SubmitFeedbackDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: SubmitFeedbackDto });

  it('aceita mensagem e origem', async () => {
    await expect(run({ message: GOOD, source: 'home' })).resolves.toMatchObject({ source: 'home' });
  });
  it.each([[{ message: GOOD, source: 'email' }], [{ message: 'short', source: 'home' }], [{ message: GOOD, source: 'home', bonusAnalyses: 99 }]])(
    'recusa %j',
    async (body) => {
      await expect(run(body)).rejects.toBeDefined();
    },
  );
});
