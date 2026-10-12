import { ValidationPipe } from '@nestjs/common';
import { CreateAnalysisDto } from './dto/create-analysis.dto';

/**
 * Mesmo motivo do set-outcome.dto.spec: so o pipe DE VERDADE (com
 * `forbidNonWhitelisted`, igual ao main.ts) mostra se o corpo passa. Campo sem
 * decorator derruba a requisicao INTEIRA, inclusive a do site.
 */
const PIPE_CONFIG = { whitelist: true, transform: true, forbidNonWhitelisted: true };
const META = { type: 'body' as const, metatype: CreateAnalysisDto };

describe('CreateAnalysisDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe(PIPE_CONFIG);

  it('aceita o corpo do site, que nao manda os campos da extensao', async () => {
    await expect(
      pipe.transform({ base64Image: 'data:image/png;base64,AAAA', analysisType: 'quick', userLanguage: 'en' }, META),
    ).resolves.toMatchObject({ analysisType: 'quick' });
  });

  it('aceita o corpo da extensao', async () => {
    const body = {
      analysisType: 'quick',
      userLanguage: 'en',
      source: 'extension',
      platform: 'tradingview',
      chartSymbol: 'FX:EURJPY',
      chartTimeframe: '5m',
    };
    await expect(pipe.transform(body, META)).resolves.toMatchObject(body);
    await expect(
      pipe.transform({ source: 'extension', platform: 'other', chartSymbol: 'BTC_USDT' }, META),
    ).resolves.toBeDefined();
  });

  it('recusa valores fora da lista e texto livre', async () => {
    await expect(pipe.transform({ source: 'app' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ platform: 'binance' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ chartSymbol: 'BTC USDT' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ chartSymbol: '<b>x</b>' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ chartSymbol: 'A'.repeat(33) }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ chartTimeframe: '123456789' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ chartTimeframe: '5 m' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ promptOverride: 'x' }, META)).rejects.toBeDefined();
  });

  it('aceita o setupId de uma atualizacao de setup, so no formato do id', async () => {
    await expect(
      pipe.transform({ analysisType: 'quick', setupId: '3f2b8c1e-6a2d-4c55-9a51-0f1b2c3d4e5f' }, META),
    ).resolves.toMatchObject({ setupId: '3f2b8c1e-6a2d-4c55-9a51-0f1b2c3d4e5f' });
    await expect(pipe.transform({ setupId: 'abc' }, META)).rejects.toBeDefined();
    await expect(pipe.transform({ setupId: "x' OR '1'='1" }, META)).rejects.toBeDefined();
  });
});
