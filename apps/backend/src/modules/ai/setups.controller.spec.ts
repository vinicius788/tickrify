import { NotFoundException } from '@nestjs/common';
import { SetupsController } from './setups.controller';
import type { SetupsService } from './setups.service';
import type { AiService } from './ai.service';
import type { SetupAlertsService } from './setup-alerts.service';
import type { PrismaService } from '../database/prisma.service';

describe('GET /api/setups/:id autenticado', () => {
  const page = { setup: { id: 'setup-aaaaaaaa' }, versions: [{ analysisId: 'analysis-1' }], nextCursor: null };
  function make() {
    const setups = { get: jest.fn(async () => page) };
    const ai = { readableAnalysisIds: jest.fn(async () => ['analysis-1']) };
    const controller = new SetupsController(setups as unknown as SetupsService, ai as unknown as AiService, {} as SetupAlertsService, {} as PrismaService);
    return { controller, setups, ai };
  }

  it('devolve a pagina e preserva usuario, paginacao e restricoes de leitura', async () => {
    const { controller, setups } = make();
    await expect(controller.get({ id: 'u1', clerkUserId: 'c1' }, 'setup-aaaaaaaa', { cursor: 'analysis-1', limit: 20 })).resolves.toEqual(page);
    expect(setups.get).toHaveBeenCalledWith('u1', 'setup-aaaaaaaa', { cursor: 'analysis-1', limit: 20, readableIds: ['analysis-1'] });
  });

  it('nao concede acesso a setup de outra conta', async () => {
    const { controller, setups } = make();
    setups.get.mockRejectedValueOnce(new NotFoundException());
    await expect(controller.get({ id: 'u2', clerkUserId: 'c2' }, 'setup-aaaaaaaa', {})).rejects.toMatchObject({ status: 404 });
    expect(setups.get).toHaveBeenCalledWith('u2', 'setup-aaaaaaaa', expect.anything());
  });
});
