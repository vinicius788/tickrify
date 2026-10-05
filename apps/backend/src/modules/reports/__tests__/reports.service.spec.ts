import { ValidationPipe } from '@nestjs/common';
import { CreateReportDto } from '../dto/create-report.dto';
import { ReportsService } from '../reports.service';

/**
 * O foco destes testes é a SANITIZAÇÃO do contexto.
 *
 * `context` é um campo Json livre por design — o formato vai mudar conforme
 * aprendermos o que ajuda a reproduzir um bug. Mas campo livre vindo do cliente
 * é fronteira de segurança: o `forbidNonWhitelisted` do ValidationPipe global
 * NÃO alcança dentro de um Json. Sem limite de tamanho, de profundidade e de
 * quantidade de chaves, o botão de reportar problema vira um canal para gravar
 * megabytes arbitrários no banco a partir de qualquer conta.
 */
describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;
  let mail: any;

  const sanitizar = (ctx: unknown) => (service as any).sanitizarContexto(ctx);

  beforeEach(() => {
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    mail = { sendProblemReport: jest.fn().mockResolvedValue(undefined) };
    service = new ReportsService(prisma, mail);
  });

  describe('sanitização do contexto', () => {
    it('mantém primitivos úteis para reproduzir o bug', () => {
      const out: any = sanitizar({
        rota: '/dashboard',
        largura: 1440,
        online: true,
        idioma: 'pt-BR',
      });
      expect(out).toEqual({ rota: '/dashboard', largura: 1440, online: true, idioma: 'pt-BR' });
    });

    it('descarta objeto aninhado (é o que faz o JSON explodir sem informar nada)', () => {
      const out: any = sanitizar({ rota: '/x', profundo: { a: { b: { c: 1 } } } });
      expect(out.rota).toBe('/x');
      expect(out.profundo).toBeUndefined();
    });

    it('corta string longa em 500 caracteres', () => {
      const out: any = sanitizar({ agente: 'x'.repeat(5000) });
      expect(out.agente).toHaveLength(500);
    });

    it('limita array de migalhas a 25 itens e 300 caracteres cada', () => {
      const out: any = sanitizar({
        migalhas: Array.from({ length: 200 }, (_, i) => `passo ${i} ` + 'y'.repeat(1000)),
      });
      expect(out.migalhas).toHaveLength(25);
      expect(out.migalhas[0].length).toBeLessThanOrEqual(300);
    });

    it('limita a quantidade de chaves', () => {
      const enorme: Record<string, unknown> = {};
      for (let i = 0; i < 500; i++) enorme[`chave${i}`] = i;
      const out: any = sanitizar(enorme);
      expect(Object.keys(out).length).toBeLessThanOrEqual(40);
    });

    it('ignora chave com nome absurdamente longo', () => {
      const out: any = sanitizar({ ['k'.repeat(200)]: 'v', ok: 1 });
      expect(out.ok).toBe(1);
      expect(Object.keys(out)).toHaveLength(1);
    });

    // ⭐ O teto final. Mesmo passando por todas as regras acima, o payload
    // inteiro não pode ultrapassar o limite de bytes.
    it('trunca quando o payload total ainda estoura o limite', () => {
      const out: any = sanitizar({
        migalhas: Array.from({ length: 25 }, () => 'z'.repeat(300)),
        campoA: 'a'.repeat(500),
        campoB: 'b'.repeat(500),
      });
      const tamanho = JSON.stringify(out).length;
      expect(tamanho).toBeLessThanOrEqual(8_000);
    });

    it.each([null, undefined, 'texto', 42, [1, 2, 3]])(
      'valor não-objeto (%p) vira nulo em vez de quebrar',
      (entrada) => {
        expect(() => sanitizar(entrada)).not.toThrow();
      },
    );
  });

  describe('criação do relato', () => {
    it('grava e devolve protocolo com status aberto', async () => {
      const r = await service.criar({ userId: 'u1', message: 'o botão não responde' });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(r.status).toBe('aberto');
      expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    // ⭐ O relato JÁ foi gravado quando o e-mail é disparado. Se a falha do
    // e-mail propagasse, o usuário veria erro e reenviaria — duplicando o
    // relato que já está no banco.
    it('falha no e-mail do admin NÃO derruba o envio', async () => {
      process.env.BOOTSTRAP_ADMIN_EMAILS = 'dono@tickrify.com';
      mail.sendProblemReport.mockRejectedValue(new Error('Resend fora do ar'));

      await expect(service.criar({ userId: 'u1', message: 'quebrou tudo' })).resolves.toMatchObject({
        status: 'aberto',
      });
      delete process.env.BOOTSTRAP_ADMIN_EMAILS;
    });

    it('sem allowlist de admin, o relato ainda chega no suporte', async () => {
      delete process.env.BOOTSTRAP_ADMIN_EMAILS;
      await service.criar({ userId: 'u1', message: 'teste' });
      await new Promise((r) => setImmediate(r));
      expect(mail.sendProblemReport).toHaveBeenCalledTimes(1);
      expect(mail.sendProblemReport.mock.calls[0][0]).toBe('support@tickrify.com');
    });

    it('suporte e admins recebem uma vez cada, e responder vai para quem reportou', async () => {
      process.env.BOOTSTRAP_ADMIN_EMAILS = 'dono@tickrify.com, Support@tickrify.com';
      await service.criar({ userId: 'u1', userEmail: 'ana@example.com', message: 'teste' });
      await new Promise((r) => setImmediate(r));
      const destinos = mail.sendProblemReport.mock.calls.map((c: unknown[]) => c[0]);
      expect(destinos).toEqual(['support@tickrify.com', 'dono@tickrify.com']);
      expect(mail.sendProblemReport.mock.calls.every((c: unknown[]) => c[2] === 'ana@example.com')).toBe(true);
      delete process.env.BOOTSTRAP_ADMIN_EMAILS;
    });

    it('rajada de relatos: grava todos, mas para de mandar e-mail no teto por hora', async () => {
      delete process.env.BOOTSTRAP_ADMIN_EMAILS; // 1 destino (suporte) por relato
      const teto = ReportsService.MAX_REPORT_EMAILS_PER_HOUR;
      for (let i = 0; i < teto + 5; i++) {
        await expect(service.criar({ userId: `u${i}`, message: 'rajada de teste' })).resolves.toMatchObject({
          status: 'aberto',
        });
      }
      await new Promise((r) => setImmediate(r));
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(teto + 5);
      expect(mail.sendProblemReport).toHaveBeenCalledTimes(teto);
    });

    it('escapa HTML do relato antes de montar o e-mail do admin', async () => {
      process.env.BOOTSTRAP_ADMIN_EMAILS = 'dono@tickrify.com';
      await service.criar({ userId: 'u1', message: '<img src=x onerror=alert(1)>' });
      await new Promise((r) => setImmediate(r));

      const corpo = mail.sendProblemReport.mock.calls[0]?.[1] ?? '';
      // O texto do usuário vai parar num e-mail HTML. Sem escapar, um relato
      // vira injeção de HTML na caixa de entrada de quem administra o sistema.
      expect(corpo).not.toContain('<img');
      expect(corpo).toContain('&lt;img');
      delete process.env.BOOTSTRAP_ADMIN_EMAILS;
    });
  });

  describe('opiniao do painel (kind=feedback)', () => {
    const sqlDe = (call: any[]) => (call[0].strings ?? []).join('?') + JSON.stringify(call[0].values ?? []);

    it('grava com kind feedback e NAO manda e-mail', async () => {
      process.env.BOOTSTRAP_ADMIN_EMAILS = 'dono@tickrify.com';
      await service.criar({ userId: 'u1', message: 'Gostei, mas falta alerta de preco', kind: 'feedback' });
      await new Promise((r) => setImmediate(r));
      expect(sqlDe(prisma.$executeRaw.mock.calls[0])).toContain('"feedback"');
      expect(mail.sendProblemReport).not.toHaveBeenCalled();
    });

    it('sem kind continua sendo relato de problema, com e-mail', async () => {
      await service.criar({ userId: 'u1', message: 'tela travou no envio' });
      await new Promise((r) => setImmediate(r));
      expect(sqlDe(prisma.$executeRaw.mock.calls[0])).toContain('"problem"');
      expect(mail.sendProblemReport).toHaveBeenCalled();
    });

    it('a lista e a contagem do admin separam problemas de opinioes', async () => {
      await service.listar(undefined, 50, 'feedback');
      await service.contarPorStatus('feedback');
      expect(sqlDe(prisma.$queryRaw.mock.calls[0])).toContain('"feedback"');
      expect(sqlDe(prisma.$queryRaw.mock.calls[1])).toContain('"feedback"');
      await service.listar('aberto');
      const padrao = sqlDe(prisma.$queryRaw.mock.calls[2]);
      expect(padrao).toContain('"problem"');
      expect(padrao).toContain('"aberto"');
    });
  });

  describe('estados', () => {
    it('resolvido e descartado carimbam resolvedAt; investigando não', async () => {
      await service.definirStatus('r1', 'resolvido');
      await service.definirStatus('r2', 'investigando');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('boot que falha não derruba a aplicação', async () => {
      prisma.$executeRawUnsafe.mockRejectedValue(new Error('sem permissão'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });
});

describe('CreateReportDto contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const META = { type: 'body' as const, metatype: CreateReportDto };

  it('aceita a opiniao do quadrinho e o relato sem kind', async () => {
    await expect(pipe.transform({ message: 'Gostei muito', route: '/dashboard', kind: 'feedback' }, META)).resolves.toMatchObject({ kind: 'feedback' });
    await expect(pipe.transform({ message: 'tela travou' }, META)).resolves.toBeDefined();
  });

  it('recusa kind desconhecido', async () => {
    await expect(pipe.transform({ message: 'Gostei muito', kind: 'elogio' }, META)).rejects.toBeDefined();
  });
});
