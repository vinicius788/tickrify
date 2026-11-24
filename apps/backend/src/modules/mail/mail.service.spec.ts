import { MailService } from './mail.service';

describe('MailService', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.RESEND_API_KEY = originalKey;
  });

  it('pagamento recusado: valor, proxima tentativa, botao para Settings e sem travessao', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '{"id":"em_1"}' });
    global.fetch = fetchMock as unknown as typeof fetch;

    const ok = await new MailService().sendPaymentFailed('ana@example.com', 'Ana <b>Souza</b>', {
      amount: 29,
      currency: 'usd',
      nextAttempt: new Date(Date.UTC(2026, 9, 24)),
    });

    expect(ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toBe("Your Tickrify payment didn't go through");
    expect(body.reply_to).toBe('support@tickrify.com');
    expect(body.html).toContain('Hi Ana,');
    expect(body.html).toContain('($29.00)');
    expect(body.html).toContain('October 24');
    expect(body.html).toContain('/dashboard/settings');
    expect(body.html).toContain('Update card');
    expect(body.html).not.toContain('<b>Souza');
    expect(body.html).not.toContain('\u2014');
  });

  it('pagamento recusado sem nova tentativa marcada nao inventa data', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendPaymentFailed('ana@example.com', null, { amount: 29, currency: 'usd', nextAttempt: null });

    const html = JSON.parse(fetchMock.mock.calls[0][1].body).html as string;
    expect(html).not.toContain('try the card again');
    expect(html).not.toContain('Hi ,');
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

  it('recuperacao nao cita cupom nem desconto (EARLY35 saiu em 23/11)', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendRecovery('ana@example.com');

    const html = JSON.parse(fetchMock.mock.calls[0][1].body).html as string;
    expect(html).not.toMatch(/EARLY|% off|code/i);
  });

  it('pedido de afiliado: vai para o suporte com codigo, dados escapados e link do /admin', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendAffiliateApplicationNotify('support@tickrify.com', {
      name: 'Eigla Rojas',
      email: 'eigla@mail.cl',
      code: 'EIGLA10',
      platform: 'instagram',
      url: 'https://instagram.com/eigla',
      audience: '1k_10k',
      note: '<script>x</script> trader de oro',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toBe('support@tickrify.com');
    expect(body.subject).toContain('EIGLA10');
    expect(body.html).toContain('Eigla Rojas');
    expect(body.html).toContain('eigla@mail.cl');
    expect(body.html).toContain('/admin?aba=afiliados');
    expect(body.html).not.toContain('<script>');
  });

  it('boas-vindas do afiliado: remetente do fundador, resposta no suporte, HTML e texto', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendAffiliateWelcome('eigla@mail.cl', { subject: 'S', html: '<p>h</p>', text: 't' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe('Vinicius from Tickrify <vinicius@tickrify.com>');
    expect(body.reply_to).toBe('support@tickrify.com');
    expect(body.text).toBe('t');
    expect(body.headers).toBeUndefined();
  });

  it('boas-vindas: assunto, remetente configurado, reply-to do suporte, icone HTTPS absoluto e versao em texto', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendWelcome('ana@example.com', 'Ana');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toBe('Welcome to Tickrify: your 3 free trade plans are ready');
    expect(body.reply_to).toBe('support@tickrify.com');
    expect(body.html).toContain('src="https://tickrify.com/icon.png"');
    expect(body.html).toContain('Hi Ana,');
    expect(body.text).toContain('Hi Ana,');
    expect(body.text).toContain('https://tickrify.com/dashboard');
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
    expect(body.from).toBe('Vinicius from Tickrify <vinicius@tickrify.com>');
    expect(body.reply_to).toBe('vinicius@tickrify.com');
    expect(body.headers['List-Unsubscribe']).toBe('<https://tickrify.onrender.com/api/email/unsubscribe?u=u1&t=abc>');
    expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('recuperacao: mostra o semanal e nao presume que a pessoa usou a IA', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    global.fetch = fetchMock as unknown as typeof fetch;

    await new MailService().sendRecovery('ana@example.com');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toBe('Your free Tickrify analyses are used up');
    expect(body.html).toContain('$7.99 for 25 analyses');
    expect(body.html).not.toMatch(/confirm entries|trading blind/);
    expect(body.html + body.subject).not.toMatch(/\u2014/);
  });
});
