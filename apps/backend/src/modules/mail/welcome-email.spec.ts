import { cleanFirstName, renderWelcomeEmail, renderWelcomeText, welcomeSubject, WELCOME_ICON_URL } from './welcome-email';

describe('renderWelcomeEmail', () => {
  const appUrl = 'https://tickrify.com';

  it('icone em URL HTTPS absoluta, marca em texto e botao apontando para o painel', () => {
    const html = renderWelcomeEmail({ appUrl });
    expect(WELCOME_ICON_URL).toMatch(/^https:\/\//);
    expect(html).toContain(`src="${WELCOME_ICON_URL}"`);
    // A marca aparece mesmo com imagem bloqueada pelo cliente de e-mail.
    expect(html).toMatch(/>Tickrify<\/td>/);
    expect(html).toContain('href="https://tickrify.com/dashboard"');
    expect(html).toContain('Analyze your first chart');
    expect(html).not.toMatch(/<svg|data:image/);
  });

  it('largura de 600px, CSS inline e modo escuro', () => {
    const html = renderWelcomeEmail({ appUrl });
    expect(html).toContain('max-width:600px');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('nao duplica a barra final da URL da aplicacao', () => {
    expect(renderWelcomeEmail({ appUrl: 'https://tickrify.com/' })).toContain(
      'href="https://tickrify.com/dashboard"',
    );
  });

  it('FRONTEND_URL invalida cai no dominio de producao', () => {
    expect(renderWelcomeEmail({ appUrl: 'tickrify.com' })).toContain('href="https://tickrify.com/dashboard"');
    expect(renderWelcomeEmail({ appUrl: '' })).toContain('href="https://tickrify.com/dashboard"');
  });

  it('sem nome nao aparece saudacao, undefined nem virgula solta', () => {
    for (const firstName of [undefined, null, '', '   ', 'undefined']) {
      const html = renderWelcomeEmail({ appUrl, firstName });
      expect(html).not.toMatch(/undefined|null/);
      expect(html).not.toContain('Hi ,');
      expect(html).not.toContain('Hi ');
      expect(renderWelcomeText({ appUrl, firstName })).not.toContain('Hi ');
    }
  });

  it('com nome, saudacao com o nome escapado', () => {
    expect(renderWelcomeEmail({ appUrl, firstName: 'Ana' })).toContain('Hi Ana,');
    const html = renderWelcomeEmail({ appUrl, firstName: '<script>x</script>' });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('a regra do gratis e a verdadeira (WAIT nao conta, teto de 10), sem travessao', () => {
    const html = renderWelcomeEmail({ appUrl });
    const text = renderWelcomeText({ appUrl });
    for (const out of [html, text]) {
      expect(out).toContain('3 free trade plans (BUY or SELL). WAIT reads do not count against them, up to 10 analyses in total.');
      expect(out).toContain('never places orders');
      expect(out).not.toContain('—');
    }
    expect(welcomeSubject()).toBe('Welcome to Tickrify: your 3 free trade plans are ready');
    expect(welcomeSubject()).not.toContain('—');
  });

  it('versao em texto puro leva o link do painel', () => {
    expect(renderWelcomeText({ appUrl })).toContain('Analyze your first chart: https://tickrify.com/dashboard');
  });

  it('cleanFirstName limita o tamanho', () => {
    expect(cleanFirstName('A'.repeat(100))).toHaveLength(40);
  });
});

describe('boas-vindas com o trial de 3 dias', () => {
  it('troca so a linha do gratis e o assunto; sem trial, igual a antes', () => {
    expect(welcomeSubject()).toContain('free trade plans');
    expect(welcomeSubject(true)).toBe('Welcome to Tickrify: your 3-day free trial is ready');
    const html = renderWelcomeEmail({ appUrl: 'https://tickrify.com', trial: true });
    expect(html).toContain('Your free trial');
    expect(html).not.toContain('free trade plans');
    expect(renderWelcomeText({ appUrl: 'https://tickrify.com', trial: true })).toContain('3 days of use');
  });
});
