import { Body, Controller, INestApplication, Post, RawBodyRequest, Req, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { deflateSync, gzipSync } from 'node:zlib';
import Stripe from 'stripe';
import { AuthGuard } from '../modules/auth/auth.guard';
import { StripeController } from '../modules/payments/stripe.controller';
import { StripeService } from '../modules/payments/stripe.service';

jest.mock('../common/analytics/posthog', () => ({ captureServer: jest.fn() }));
jest.mock('../common/analytics/meta-capi', () => ({ sendMetaEvent: jest.fn() }));

@Controller('compatibility')
class JsonController {
  @Post('json')
  echo(@Body() body: Record<string, unknown>, @Req() req: RawBodyRequest<Request>) {
    return { body, raw: req.rawBody?.toString('utf8') };
  }
}

describe('HTTP body parsing and Stripe raw-body compatibility', () => {
  const originalEnv = { ...process.env };
  const secret = 'whsec_body_parser_compatibility_test_only';
  const signer = new Stripe('sk_test_body_parser_compatibility_only');
  const payload = '{\n  "id": "evt_parser_compatibility", "type": "compatibility.test",\n  "data": {"object": {"note": "ação ✓"}}\n}';
  let app: INestApplication;
  let port: number;
  let service: StripeService;
  let webhook: jest.SpyInstance;
  let claim: jest.SpyInstance;

  // Use a real HTTP connection and exact bytes, including for compressed JSON.
  function post(path: string, body: Buffer | string, headers: Record<string, string> = {}) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1', port, path: `/api/${path}`, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(bytes.length), ...headers },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.setTimeout(3000, () => req.destroy(new Error('Compatibility request timed out')));
      req.on('error', reject);
      req.end(bytes);
    });
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_body_parser_compatibility_only';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    service = new StripeService(
      {} as ConstructorParameters<typeof StripeService>[0],
      {} as ConstructorParameters<typeof StripeService>[1],
    );
    // Keep real signature verification; replace only persistence with local fakes.
    claim = jest.spyOn(service as any, 'claimWebhookEvent').mockResolvedValue('claimed');
    jest.spyOn(service as any, 'finishWebhookEvent').mockResolvedValue(undefined);
    webhook = jest.spyOn(service, 'handleWebhookEvent');
    const moduleRef = await Test.createTestingModule({
      controllers: [JsonController, StripeController],
      providers: [{ provide: StripeService, useValue: { handleWebhookEvent: service.handleWebhookEvent.bind(service) } }],
    }).overrideGuard(AuthGuard).useValue({ canActivate: () => true }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app?.close();
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('parses JSON without changing its original UTF-8 bytes', async () => {
    const text = ' { "note": "ação ✓", "nested": {"enabled": true} }\n';
    expect(await post('compatibility/json', text)).toEqual({ status: 201, body: { body: JSON.parse(text), raw: text } });
  });

  it.each([['gzip', gzipSync], ['deflate', deflateSync]] as const)('parses valid %s JSON', async (encoding, compress) => {
    const text = '{"value":42}';
    expect(await post('compatibility/json', compress(text), { 'content-encoding': encoding }))
      .toEqual({ status: 201, body: { body: { value: 42 }, raw: text } });
  });

  it('continues parsing URL-encoded forms', async () => {
    expect(await post('compatibility/json', 'note=a%C3%A7%C3%A3o&nested[value]=42', { 'content-type': 'application/x-www-form-urlencoded' }))
      .toMatchObject({ status: 201, body: { body: { note: 'ação', nested: { value: '42' } } } });
  });

  it('rejects malformed JSON and oversized JSON', async () => {
    expect((await post('compatibility/json', '{broken')).status).toBe(400);
    expect((await post('compatibility/json', JSON.stringify({ text: 'x'.repeat(110 * 1024) }))).status).toBe(413);
  });

  it('rejects malformed compressed bodies and remains available', async () => {
    expect((await post('compatibility/json', Buffer.from('not gzip'), { 'content-encoding': 'gzip' })).status).toBe(400);
    expect((await post('compatibility/json', '{"alive":true}')).status).toBe(201);
  });

  it('survives trailing bytes after a valid compressed JSON frame', async () => {
    const body = Buffer.concat([gzipSync('{"value":42}'), Buffer.from('invalid trailing bytes')]);
    const response = await post('compatibility/json', body, { 'content-encoding': 'gzip' });
    // Depending on decoder timing the malformed stream can be rejected or the
    // complete JSON accepted; neither outcome may terminate the server process.
    expect([201, 400]).toContain(response.status);
    expect((await post('compatibility/json', '{"alive":true}')).status).toBe(201);
  });

  it('verifies a signed Stripe webhook using the exact original body', async () => {
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret });
    expect(await post('stripe/webhook', payload, { 'stripe-signature': signature }))
      .toEqual({ status: 200, body: { received: true } });
    expect(webhook).toHaveBeenCalledWith(signature, Buffer.from(payload));
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('preserves signed webhook bytes after gzip decompression', async () => {
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret });
    expect((await post('stripe/webhook', gzipSync(payload), { 'stripe-signature': signature, 'content-encoding': 'gzip' })).status).toBe(200);
    expect(webhook).toHaveBeenCalledWith(signature, Buffer.from(payload));
  });

  it('rejects a modified signed body before persistence', async () => {
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret });
    expect((await post('stripe/webhook', `${payload}\n`, { 'stripe-signature': signature })).status).toBe(400);
    expect(claim).not.toHaveBeenCalled();
  });

  it('rejects a missing webhook signature before invoking the service', async () => {
    expect((await post('stripe/webhook', payload)).status).toBe(400);
    expect(webhook).not.toHaveBeenCalled();
  });
});
