import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { attachRequestContext, currentClientIp, resolveClientIp, runWithClientIp } from '../request-context.middleware';

@Controller('ip-probe')
class IpProbe {
  @Post('json')
  json() {
    return { ip: currentClientIp() };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('image'))
  upload(@UploadedFile() _file: unknown) {
    return { ip: currentClientIp() };
  }
}

describe('IP real da requisicao', () => {
  it('cf-connecting-ip vence o req.ip; valor invalido cai no req.ip', () => {
    expect(resolveClientIp({ ip: '10.0.0.1', headers: { 'cf-connecting-ip': '198.51.100.7' } })).toBe('198.51.100.7');
    expect(resolveClientIp({ ip: '::ffff:203.0.113.9', headers: { 'cf-connecting-ip': 'x' } })).toBe('203.0.113.9');
    expect(resolveClientIp({ headers: {} })).toBeNull();
  });

  it('job da fila roda com o IP de quem pediu; sem IP fica null', () => {
    expect(runWithClientIp('198.51.100.7', () => currentClientIp())).toBe('198.51.100.7');
    expect(runWithClientIp(undefined, () => currentClientIp())).toBeNull();
    expect(currentClientIp()).toBeNull();
  });

  describe('no Nest, depois dos parsers', () => {
    let app: Awaited<ReturnType<typeof boot>>;
    async function boot() {
      const moduleRef = await Test.createTestingModule({ controllers: [IpProbe] }).compile();
      const nest = moduleRef.createNestApplication({ rawBody: true });
      nest.use(attachRequestContext);
      await nest.init();
      return nest;
    }
    beforeAll(async () => {
      app = await boot();
    });
    afterAll(async () => {
      await app.close();
    });

    it('JSON', async () => {
      const res = await request(app.getHttpServer()).post('/ip-probe/json').set('CF-Connecting-IP', '198.51.100.7').send({ a: 1 });
      expect(res.body.ip).toBe('198.51.100.7');
    });

    it('upload multipart', async () => {
      const res = await request(app.getHttpServer())
        .post('/ip-probe/upload')
        .set('CF-Connecting-IP', '198.51.100.8')
        .attach('image', Buffer.from('x'), 'a.png');
      expect(res.body.ip).toBe('198.51.100.8');
    });

    it('webhook da Stripe nunca leva IP', async () => {
      const res = await request(app.getHttpServer())
        .post('/ip-probe/json')
        .set('CF-Connecting-IP', '198.51.100.9')
        .set('Stripe-Signature', 't=1,v1=x')
        .send({ a: 1 });
      expect(res.body.ip).toBeNull();
    });
  });
});
