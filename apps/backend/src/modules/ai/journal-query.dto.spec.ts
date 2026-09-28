import { ValidationPipe } from '@nestjs/common';
import { JournalQueryDto } from './dto/journal-query.dto';

/**
 * Mesmo motivo do set-strategy.dto.spec: o pipe global roda com
 * `forbidNonWhitelisted`, e so o pipe DE VERDADE mostra se a requisicao que a
 * tela manda passa. Os valores abaixo sao exatamente o que o navegador gera
 * com `new Date(...).toISOString()`.
 */
const PIPE_CONFIG = { whitelist: true, transform: true, forbidNonWhitelisted: true };
const META = { type: 'query' as const, metatype: JournalQueryDto };

describe('JournalQueryDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);

  it('aceita o intervalo do jeito que o navegador envia', async () => {
    const query = { from: '2026-09-01T03:00:00.000Z', to: '2026-10-01T03:00:00.000Z' };
    await expect(pipe.transform(query, META)).resolves.toMatchObject(query);
  });

  it('recusa data invalida, campo faltando e campo desconhecido', async () => {
    await expect(pipe.transform({ from: 'ontem', to: '2026-10-01T03:00:00.000Z' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ from: '2026-09-01T03:00:00.000Z' }, META)).rejects.toBeDefined();
    await expect(
      pipe.transform({ from: '2026-09-01T03:00:00.000Z', to: '2026-10-01T03:00:00.000Z', userId: 'x' }, META),
    ).rejects.toBeDefined();
  });
});
