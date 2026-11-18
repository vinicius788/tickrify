import { NotFoundException } from '@nestjs/common';
import { SetupsController } from './setups.controller';
import type { SetupsService } from './setups.service';
import type { AiService } from './ai.service';
import type { SetupAlertsService } from './setup-alerts.service';
import type { PrismaService } from '../database/prisma.service';
import { __resetFlagCacheForTests, applyFlagOverrideLocally, resolveFlag } from '../../common/flags/feature-flags';

describe('SETUP_LIVE_VIEW: projecao no GET autenticado', () => {
  afterEach(__resetFlagCacheForTests);
  const page = { setup: { id: 'setup-aaaaaaaa' }, versions: [{ analysisId: 'analysis-1' }], nextCursor: null };
  function make() {
    const setups = { get: jest.fn(async () => page) };
    const ai = { readableAnalysisIds: jest.fn(async () => ['analysis-1']) };
    const controller = new SetupsController(setups as unknown as SetupsService, ai as unknown as AiService, {} as SetupAlertsService, {} as PrismaService);
    return { controller, setups, ai };
  }

  it('duas flags novas vem em 0; detalhe nao liga o recurso por padrao', async () => {
    expect(resolveFlag('SETUP_LIVE_VIEW').definition.defaultValue).toBe('0');
    expect(resolveFlag('SETUP_CONTINUATION_REASON').definition.defaultValue).toBe('0');
    applyFlagOverrideLocally('SETUP_LIVE_VIEW', '0');
    const { controller } = make();
    await expect(controller.get({ id: 'u1', clerkUserId: 'c1' }, 'setup-aaaaaaaa', {})).resolves.toEqual({ ...page, monitoringEnabled: false });
  });

  it('1 expoe a secao e preserva usuario, paginacao e restricoes de leitura', async () => {
    applyFlagOverrideLocally('SETUP_LIVE_VIEW', '1');
    const { controller, setups } = make();
    await expect(controller.get({ id: 'u1', clerkUserId: 'c1' }, 'setup-aaaaaaaa', { cursor: 'analysis-1', limit: 20 })).resolves.toEqual({ ...page, monitoringEnabled: true });
    expect(setups.get).toHaveBeenCalledWith('u1', 'setup-aaaaaaaa', { cursor: 'analysis-1', limit: 20, readableIds: ['analysis-1'] });
  });

  it('nao concede acesso a setup de outra conta quando a flag esta ligada', async () => {
    applyFlagOverrideLocally('SETUP_LIVE_VIEW', '1');
    const { controller, setups } = make();
    setups.get.mockRejectedValueOnce(new NotFoundException());
    await expect(controller.get({ id: 'u2', clerkUserId: 'c2' }, 'setup-aaaaaaaa', {})).rejects.toMatchObject({ status: 404 });
    expect(setups.get).toHaveBeenCalledWith('u2', 'setup-aaaaaaaa', expect.anything());
  });
});
