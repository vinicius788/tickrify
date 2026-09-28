import { cleanFirstName, renderWelcomeEmail, WELCOME_LOGO_URL } from './welcome-email';

describe('renderWelcomeEmail', () => {
  const appUrl = 'https://tickrify.com';

  it('logo em URL HTTPS absoluta e botao apontando para o painel', () => {
    const html = renderWelcomeEmail({ appUrl });
    expect(WELCOME_LOGO_URL).toMatch(/^https:\/\//);
    expect(html).toContain(`src="${WELCOME_LOGO_URL}"`);
    expect(html).toContain('href="https://tickrify.com/dashboard"');
    expect(html).toContain('Analyze a chart');
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
      expect(html).toContain('Welcome to Tickrify.');
    }
  });

  it('com nome, saudacao com o nome escapado', () => {
    expect(renderWelcomeEmail({ appUrl, firstName: 'Ana' })).toContain('Hi Ana,');
    const html = renderWelcomeEmail({ appUrl, firstName: '<script>x</script>' });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('textos e preview exatos, sem travessao', () => {
    const html = renderWelcomeEmail({ appUrl });
    expect(html).toContain('Your 3 free analyses are ready');
    expect(html).toContain('Your Tickrify account is ready. Analyze your first chart.');
    expect(html).toContain('Tickrify provides analytical information and a second opinion, not financial advice. Trading involves risk. The decision is yours.');
    expect(html).not.toContain('—');
  });

  it('cleanFirstName limita o tamanho', () => {
    expect(cleanFirstName('A'.repeat(100))).toHaveLength(40);
  });
});
