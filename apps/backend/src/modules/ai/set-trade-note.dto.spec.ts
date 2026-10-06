import { ValidationPipe } from '@nestjs/common';
import { SetTradeNoteDto } from './dto/set-trade-note.dto';

/**
 * Pipe DE VERDADE (com `forbidNonWhitelisted`, igual ao main.ts): campo sem
 * decorator faria a requisicao inteira ser recusada. Os corpos abaixo sao os
 * que o Diario envia.
 */
const PIPE_CONFIG = { whitelist: true, transform: true, forbidNonWhitelisted: true };
const META = { type: 'body' as const, metatype: SetTradeNoteDto };

describe('SetTradeNoteDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);

  it('aceita o corpo completo, o parcial e o de apagar', async () => {
    const full = { note: 'Waited for the retest.', setup: 'pullback', emotion: 'calm', mistakes: ['oversized', 'early_exit'] };
    await expect(pipe.transform(full, META)).resolves.toMatchObject(full);
    await expect(pipe.transform({ emotion: 'fomo' }, META)).resolves.toMatchObject({ emotion: 'fomo' });
    await expect(pipe.transform({ note: null, setup: null, emotion: null, mistakes: [] }, META)).resolves.toBeDefined();
  });

  it('recusa valor fora das listas, nota longa e campo desconhecido', async () => {
    await expect(pipe.transform({ setup: 'scalp' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ mistakes: ['early_exit', 'x'] }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ note: 'a'.repeat(1001) }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ note: 'ok', userId: 'x' }, META)).rejects.toBeDefined();
  });
});
