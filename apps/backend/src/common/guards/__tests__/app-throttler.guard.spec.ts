import { AppThrottlerGuard } from '../app-throttler.guard';

/**
 * O rastreador do rate limit decide QUEM está sendo limitado. Se ele puder ser
 * manipulado pelo cliente, o limite inteiro vira decoração: basta variar o valor
 * a cada requisição para nunca bater no teto.
 */
describe('AppThrottlerGuard — de quem é o IP', () => {
  const guard = new AppThrottlerGuard({} as any, {} as any, {} as any);
  const resolver = (req: any) => (guard as any).resolveIp(req);
  const rastrear = (req: any) => (guard as any).getTracker(req);

  it('sem Cloudflare, usa o primeiro X-Forwarded-For (comportamento de hoje)', () => {
    expect(resolver({ headers: {}, ips: ['203.0.113.9', '10.0.0.1'], ip: '10.0.0.1' })).toBe('203.0.113.9');
  });

  it('cai para req.ip quando não há lista de proxies', () => {
    expect(resolver({ headers: {}, ips: [], ip: '198.51.100.7' })).toBe('198.51.100.7');
  });

  it('último recurso: o socket', () => {
    expect(resolver({ headers: {}, socket: { remoteAddress: '192.0.2.5' } })).toBe('192.0.2.5');
  });

  // ⭐ O ponto do item 11.
  //
  // X-Forwarded-For é uma lista que o próprio cliente pode COMEÇAR. Um atacante
  // que manda um XFF diferente a cada requisição some do rate limit. O
  // CF-Connecting-IP é sobrescrito pela Cloudflare com o IP da conexão TCP real.
  it('com Cloudflare, ignora o X-Forwarded-For forjado pelo atacante', () => {
    const req = {
      headers: { 'cf-connecting-ip': '203.0.113.55', 'x-forwarded-for': '1.2.3.4' },
      ips: ['1.2.3.4', '203.0.113.55'],
      ip: '10.0.0.1',
    };
    expect(resolver(req)).toBe('203.0.113.55');
  });

  it('cabeçalho da Cloudflare vazio não atrapalha o caminho antigo', () => {
    const req = { headers: { 'cf-connecting-ip': '   ' }, ips: ['203.0.113.9'], ip: '10.0.0.1' };
    expect(resolver(req)).toBe('203.0.113.9');
  });

  describe('rastreador', () => {
    it('usuário autenticado é limitado por conta E por IP', async () => {
      const t = await rastrear({ headers: {}, ips: ['203.0.113.9'], user: { id: 'usr_1' } });
      expect(t).toBe('usr_1:203.0.113.9');
    });

    it('anônimo é limitado só por IP', async () => {
      const t = await rastrear({ headers: {}, ips: ['203.0.113.9'] });
      expect(t).toBe('203.0.113.9');
    });

    // Duas contas atrás do mesmo IP não podem compartilhar cota: isso puniria
    // escritório, faculdade e café inteiros por causa de um usuário pesado.
    it('duas contas no mesmo IP têm cotas separadas', async () => {
      const a = await rastrear({ headers: {}, ips: ['203.0.113.9'], user: { id: 'usr_1' } });
      const b = await rastrear({ headers: {}, ips: ['203.0.113.9'], user: { id: 'usr_2' } });
      expect(a).not.toBe(b);
    });
  });
});
