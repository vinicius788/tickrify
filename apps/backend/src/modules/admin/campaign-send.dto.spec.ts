import { ValidationPipe } from '@nestjs/common';
import { CampaignSendDto } from './dto/campaign-send.dto';

const PIPE_CONFIG = { whitelist: true, transform: true, forbidNonWhitelisted: true };
const META = { type: 'body' as const, metatype: CampaignSendDto };

describe('CampaignSendDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);

  it('so dispara com confirm "SEND"; grupos opcionais e da lista', async () => {
    await expect(pipe.transform({ confirm: 'SEND' }, META)).resolves.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND', segments: ['exhausted', 'one_left'] }, META)).resolves.toBeDefined();
    await expect(pipe.transform({}, META)).rejects.toBeDefined();
    await expect(pipe.transform({ confirm: 'yes' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND', segments: ['everyone'] }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND', segments: [] }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ confirm: 'SEND', extra: 1 }, META)).rejects.toBeDefined();
  });
});
