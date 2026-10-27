import { ValidationPipe } from '@nestjs/common';
import { FounderSendDto } from './dto/founder-send.dto';

const PIPE_CONFIG = { whitelist: true, transform: true, forbidNonWhitelisted: true };
const META = { type: 'body' as const, metatype: FounderSendDto };

describe('FounderSendDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);

  it('lista de e-mails validos; confirm opcional e so "SEND"; nada alem disso', async () => {
    await expect(pipe.transform({ emails: ['a@x.com'] }, META)).resolves.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND', emails: ['a@x.com', 'b@y.org'] }, META)).resolves.toBeDefined();
    await expect(pipe.transform({ confirm: 'yes', emails: ['a@x.com'] }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND', emails: [] }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND', emails: ['not-an-email'] }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND', emails: ['a@x.com'], extra: 1 }, META)).rejects.toBeDefined();
  });

  it('no maximo 40 por disparo', async () => {
    const forty = Array.from({ length: 40 }, (_, i) => `p${i}@x.com`);
    await expect(pipe.transform({ emails: forty }, META)).resolves.toBeDefined();
    await expect(pipe.transform({ emails: [...forty, 'extra@x.com'] }, META)).rejects.toBeDefined();
  });
});
