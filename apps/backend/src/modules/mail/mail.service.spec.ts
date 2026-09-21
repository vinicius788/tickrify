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
});
