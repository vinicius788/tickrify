import { ValidationPipe } from '@nestjs/common';
import { AuthController, SetAcquisitionSourceDto, SetPreferencesDto } from './auth.controller';
import { captureServer as captureServerMock } from '../../common/analytics/posthog';

jest.mock('../../common/analytics/posthog', () => ({
  ...jest.requireActual('../../common/analytics/posthog'),
  captureServer: jest.fn(),
}));
const captureServer = captureServerMock as jest.Mock;

/**
 * "Onde voce ouviu falar da gente?" (AcquisitionSurvey). So o pipe DE VERDADE
 * (com `forbidNonWhitelisted`, igual ao main.ts) mostra se o corpo que a tela
 * manda passa: campo sem decorator derruba a requisicao inteira.
 */
const PIPE_CONFIG = { whitelist: true, transform: true, forbidNonWhitelisted: true };
const META = { type: 'body' as const, metatype: SetAcquisitionSourceDto };

describe('SetAcquisitionSourceDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);

  it('aceita todas as opcoes da tela, com e sem detalhe', async () => {
    for (const source of ['chatgpt', 'other_ai', 'google', 'social', 'community', 'friend', 'ad', 'other']) {
      await expect(pipe.transform({ source }, META)).resolves.toMatchObject({ source });
    }
    await expect(pipe.transform({ source: 'other', detail: 'a podcast' }, META)).resolves.toMatchObject({ detail: 'a podcast' });
  });

  it('recusa origem fora da lista, campo desconhecido e detalhe longo', async () => {
    await expect(pipe.transform({ source: 'tiktok' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ source: 'google', userId: 'x' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ source: 'other', detail: 'x'.repeat(121) }, META)).rejects.toBeDefined();
  });
});

describe('POST /auth/acquisition-source', () => {
  let prisma: any;
  let controller: AuthController;

  beforeEach(() => {
    captureServer.mockClear();
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'usr_1', clerkUserId: 'clerk_1', acquisitionSource: null }),
        update: jest.fn().mockResolvedValue({ id: 'usr_1' }),
      },
    };
    controller = new AuthController(prisma, {} as any);
  });

  it('grava a primeira resposta nas colunas do User e marca a pessoa no PostHog', async () => {
    await expect(
      controller.setAcquisitionSource({ id: 'usr_1', clerkUserId: 'clerk_1' }, { source: 'chatgpt', detail: '  asked for chart tools ' }),
    ).resolves.toEqual({ ok: true });

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ acquisitionSource: 'chatgpt', acquisitionDetail: 'asked for chart tools' });
    expect(data.acquisitionAnsweredAt).toBeInstanceOf(Date);
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'acquisition_source_answered', {
      source: 'chatgpt',
      $set_once: { acquisition_source: 'chatgpt' },
    });
  });

  it('a primeira resposta vale: reenvio nao sobrescreve nem manda evento', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', clerkUserId: 'clerk_1', acquisitionSource: 'google' });
    await expect(
      controller.setAcquisitionSource({ id: 'usr_1', clerkUserId: 'clerk_1' }, { source: 'ad' }),
    ).resolves.toEqual({ ok: true, alreadyAnswered: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(captureServer).not.toHaveBeenCalled();
  });
});

describe('PATCH /auth/preferences (tema)', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);
  const PREFS = { type: 'body' as const, metatype: SetPreferencesDto };

  it('aceita so dark e light', async () => {
    await expect(pipe.transform({ theme: 'light' }, PREFS)).resolves.toMatchObject({ theme: 'light' });
    await expect(pipe.transform({ theme: 'dark' }, PREFS)).resolves.toMatchObject({ theme: 'dark' });
    await expect(pipe.transform({ theme: 'blue' }, PREFS)).rejects.toBeDefined();
    await expect(pipe.transform({ theme: 'light', userId: 'x' }, PREFS)).rejects.toBeDefined();
  });

  it('grava pela conta do token e so emite theme_changed quando muda', async () => {
    captureServer.mockClear();
    const prisma: any = { $executeRawUnsafe: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) };
    const controller = new AuthController(prisma, {} as any);

    await controller.setPreferences({ clerkUserId: 'clerk_1' }, { theme: 'light' });
    await controller.setPreferences({ clerkUserId: 'clerk_1' }, { theme: 'light' });

    expect(prisma.$executeRawUnsafe.mock.calls[0].slice(1)).toEqual(['clerk_1', 'light']);
    expect(captureServer).toHaveBeenCalledTimes(1);
    expect(captureServer).toHaveBeenCalledWith('clerk_1', 'theme_changed', { theme: 'light', $set: { theme: 'light' } });
  });
});
