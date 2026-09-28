import { AppThrottlerGuard } from '../app-throttler.guard';
import { Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

const request = require('supertest');

@Controller('throttle-probe')
class ThrottleProbe {
  @Get()
  get() { return { ok: true }; }
}

/**
 * O rastreador do rate limit decide QUEM está sendo limitado. Se ele puder ser
 * manipulado pelo cliente, o limite inteiro vira decoração: basta variar o valor
 * a cada requisição para nunca bater no teto.
 */
describe('AppThrottlerGuard — de quem é o IP', () => {
  const guard = new AppThrottlerGuard({} as any, {} as any, {} as any);
  const resolver = (req: any) => (guard as any).resolveIp(req);
  const rastrear = (req: any) => (guard as any).getTracker(req);

  it('usa o IP resolvido pelo Express, sem reinterpretar a cadeia de proxies', () => {
    expect(resolver({ headers: {}, ips: ['203.0.113.9', '10.0.0.1'], ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('cai para req.ip quando não há lista de proxies', () => {
    expect(resolver({ headers: {}, ips: [], ip: '198.51.100.7' })).toBe('198.51.100.7');
  });

  it('último recurso: o socket', () => {
    expect(resolver({ headers: {}, socket: { remoteAddress: '192.0.2.5' } })).toBe('192.0.2.5');
  });

  it('ignora CF-Connecting-IP e X-Forwarded-For fornecidos pelo cliente', () => {
    const req = {
      headers: { 'cf-connecting-ip': '203.0.113.55', 'x-forwarded-for': '1.2.3.4' },
      ips: ['1.2.3.4', '203.0.113.55'],
      ip: '10.0.0.1',
    };
    expect(resolver(req)).toBe('10.0.0.1');
  });

  it('cabeçalho da Cloudflare vazio não atrapalha o caminho antigo', () => {
    const req = { headers: { 'cf-connecting-ip': '   ' }, ips: ['203.0.113.9'], ip: '10.0.0.1' };
    expect(resolver(req)).toBe('10.0.0.1');
  });

  it('variar o cabeçalho CF não renova a cota da mesma conexão', async () => {
    const request = { ip: '192.0.2.10', socket: { remoteAddress: '192.0.2.10' } };
    const a = await rastrear({ ...request, headers: { 'cf-connecting-ip': '198.51.100.1' } });
    const b = await rastrear({ ...request, headers: { 'cf-connecting-ip': '198.51.100.2' } });
    expect(a).toBe('192.0.2.10');
    expect(b).toBe(a);
  });

  describe('rastreador', () => {
    it('usuário autenticado é limitado por conta E por IP', async () => {
      const t = await rastrear({ headers: {}, ip: '203.0.113.9', user: { id: 'usr_1' } });
      expect(t).toBe('usr_1:203.0.113.9');
    });

    it('anônimo é limitado só por IP', async () => {
      const t = await rastrear({ headers: {}, ip: '203.0.113.9' });
      expect(t).toBe('203.0.113.9');
    });

    // Duas contas atrás do mesmo IP não podem compartilhar cota: isso puniria
    // escritório, faculdade e café inteiros por causa de um usuário pesado.
    it('duas contas no mesmo IP têm cotas separadas', async () => {
      const a = await rastrear({ headers: {}, ip: '203.0.113.9', user: { id: 'usr_1' } });
      const b = await rastrear({ headers: {}, ip: '203.0.113.9', user: { id: 'usr_2' } });
      expect(a).not.toBe(b);
    });
  });
});

describe('rate limit HTTP behind one trusted ingress', () => {
  it('changing spoofed CF and leftmost XFF headers cannot renew the IP bucket', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1 }])],
      controllers: [ThrottleProbe],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    await app.init();
    try {
      const first = await request(app.getHttpServer()).get('/throttle-probe')
        .set('CF-Connecting-IP', '198.51.100.1')
        .set('X-Forwarded-For', '198.51.100.1, 192.0.2.10');
      const second = await request(app.getHttpServer()).get('/throttle-probe')
        .set('CF-Connecting-IP', '198.51.100.2')
        .set('X-Forwarded-For', '198.51.100.2, 192.0.2.10');
      const differentClient = await request(app.getHttpServer()).get('/throttle-probe')
        .set('X-Forwarded-For', '192.0.2.11');
      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(differentClient.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
