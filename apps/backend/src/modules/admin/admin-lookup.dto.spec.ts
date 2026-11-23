import { ValidationPipe } from '@nestjs/common';
import { AdminIdParamDto, AdminSearchQueryDto } from './dto/admin-lookup.dto';

const PIPE_CONFIG = { whitelist: true, transform: true, forbidNonWhitelisted: true };

describe('DTOs de busca do /admin contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);
  const query = { type: 'query' as const, metatype: AdminSearchQueryDto };
  const param = { type: 'param' as const, metatype: AdminIdParamDto };

  it('busca: texto de 2 a 100 caracteres e nenhum campo extra', async () => {
    await expect(pipe.transform({ q: 'XAUUSD' }, query)).resolves.toBeDefined();
    await expect(pipe.transform({ q: 'a@b.com' }, query)).resolves.toBeDefined();
    await expect(pipe.transform({}, query)).rejects.toBeDefined();
    await expect(pipe.transform({ q: 'a' }, query)).rejects.toBeDefined();
    await expect(pipe.transform({ q: 'x'.repeat(101) }, query)).rejects.toBeDefined();
    await expect(pipe.transform({ q: ['a', 'b'] }, query)).rejects.toBeDefined();
    await expect(pipe.transform({ q: 'ok', extra: 1 }, query)).rejects.toBeDefined();
  });

  it('id: so o formato de id, sem barra nem espaco', async () => {
    await expect(pipe.transform({ id: 'cmabc123def456ghi789' }, param)).resolves.toBeDefined();
    await expect(pipe.transform({ id: 'abc' }, param)).rejects.toBeDefined();
    await expect(pipe.transform({ id: '../../etc/passwd' }, param)).rejects.toBeDefined();
    await expect(pipe.transform({ id: 'abc def ghi jkl' }, param)).rejects.toBeDefined();
  });
});
