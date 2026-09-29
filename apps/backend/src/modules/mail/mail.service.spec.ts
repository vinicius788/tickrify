import { MailService } from './mail.service';

describe('MailService', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.RESEND_API_KEY = originalKey;
  });

  it('respostas ao e-mail vao para o suporte, nao para o noreply', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendRecovery('ana@example.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toBe('ana@example.com');
    expect(body.reply_to).toBe('support@tickrify.com');
  });

  it('recuperacao so cita o cupom quando a oferta vem ativa', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendRecovery('ana@example.com', { code: 'EARLY35', percentOff: 35 });
    await new MailService().sendRecovery('ana@example.com', null);

    const [comOferta, semOferta] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).html as string);
    expect(comOferta).toContain('EARLY35');
    expect(comOferta).toContain('35% off');
    expect(semOferta).not.toContain('EARLY35');
    expect(semOferta).not.toMatch(/% off/);
  });

  it('boas-vindas: assunto, remetente configurado, reply-to do suporte e logo HTTPS absoluta', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendWelcome('ana@example.com', 'Ana');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toBe('Your 3 free Tickrify analyses are ready');
    expect(body.reply_to).toBe('support@tickrify.com');
    expect(body.html).toContain('src="https://tickrify.com/logo.png"');
    expect(body.html).toContain('Hi Ana,');
  });

  it('boas-vindas: falha da Resend nao lanca erro', async () => {
    process.env.RESEND_API_KEY = 're_test';
    global.fetch = jest.fn().mockRejectedValue(new Error('rede caiu')) as unknown as typeof fetch;

    await expect(new MailService().sendWelcome('ana@example.com')).resolves.toBeUndefined();
  });

  it('ciclo de vida: sai em nome do fundador e com descadastro de um clique', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '{"id":"re_1"}' });
    global.fetch = fetchMock as unknown as typeof fetch;

    const ok = await new MailService().sendLifecycle('ana@example.com', {
      kind: 'activation_1',
      subject: 'S',
      html: '<p>x</p>',
      unsubscribeUrl: 'https://tickrify.onrender.com/api/email/unsubscribe?u=u1&t=abc',
    });

    expect(ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('Vini from Tickrify <vinicius@tickrify.com>');
    expect(body.reply_to).toBe('vinicius@tickrify.com');
    expect(body.headers['List-Unsubscribe']).toBe('<https://tickrify.onrender.com/api/email/unsubscribe?u=u1&t=abc>');
    expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});
