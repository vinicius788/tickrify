import { ValidationPipe } from '@nestjs/common';
import { SetOutcomeDto } from './dto/set-outcome.dto';

/**
 * Mesmo motivo do set-strategy.dto.spec: so o pipe DE VERDADE (com
 * `forbidNonWhitelisted`, igual ao main.ts) mostra se o que a tela manda passa.
 * Os corpos abaixo sao os que o My Trades e o painel enviam.
 */
const PIPE_CONFIG = { whitelist: true, transform: true, forbidNonWhitelisted: true };
const META = { type: 'body' as const, metatype: SetOutcomeDto };

describe('SetOutcomeDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);

  it('aceita todos os vereditos da tela, inclusive entrada nao atingida e limpar', async () => {
    for (const outcome of ['tp1', 'tp2', 'stop', 'open', 'no_fill']) {
      await expect(pipe.transform({ outcome, pnlAmount: null }, META)).resolves.toMatchObject({ outcome });
    }
    await expect(pipe.transform({ outcome: null }, META)).resolves.toBeDefined();
  });

  it('recusa veredito desconhecido e campo desconhecido', async () => {
    await expect(pipe.transform({ outcome: 'WIN' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ outcome: 'tp1', userId: 'x' }, META)).rejects.toBeDefined();
  });
});
