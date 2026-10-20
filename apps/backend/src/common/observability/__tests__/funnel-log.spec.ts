import { formatFunnelLine, funnelLog, safeErrorFields, safeFunnelDetails } from '../funnel-log';

describe('funnel-log', () => {
  it('formata uma linha pesquisavel e ignora campos vazios', () => {
    expect(formatFunnelLine('checkout_session_created', { user: 'cm1', session: 'cs_live_1', plan: 'starter', code: null })).toBe(
      '[funnel] stage=checkout_session_created user=cm1 plan=starter session=cs_live_1',
    );
  });

  it('metodos de pagamento da sessao e a configuracao do painel entram na linha', () => {
    expect(
      formatFunnelLine('checkout_session_created', {
        session: 'cs_1',
        paymentMethodTypes: 'card,link',
        paymentMethodConfig: 'pmc_1',
      }),
    ).toBe('[funnel] stage=checkout_session_created session=cs_1 paymentMethodTypes=card,link paymentMethodConfig=pmc_1');
  });

  it('nunca deixa passar chave nem e-mail, venha no campo que vier', () => {
    const line = formatFunnelLine('checkout_failed', {
      message: 'Invalid API Key provided: sk_live_51ABCdef for ana@example.com with whsec_abc123',
    });
    expect(line).not.toMatch(/sk_live_51ABCdef|whsec_abc123|ana@example\.com/);
    expect(line).toContain('[redacted]');
    expect(line).toContain('[redacted-email]');
  });

  it('campo fora da lista nao entra no log nem no banco', () => {
    const fields = { user: 'cm1', card: '4242424242424242', email: 'a@b.com' } as any;
    expect(formatFunnelLine('payment_failed', fields)).toBe('[funnel] stage=payment_failed user=cm1');
    expect(safeFunnelDetails(fields)).toEqual({ user: 'cm1' });
  });

  it('erro da Stripe: so tipo, codigo, recusa, requestId e mensagem', () => {
    const stripeErr = { type: 'StripeCardError', code: 'card_declined', decline_code: 'insufficient_funds', requestId: 'req_1', message: 'Your card has insufficient funds.', raw: { headers: 'x' }, payload: '{...}' };
    expect(safeErrorFields(stripeErr)).toEqual({ code: 'card_declined', declineCode: 'insufficient_funds', requestId: 'req_1', message: 'Your card has insufficient funds.' });
  });

  it('grava a etapa no AdminAudit do usuario e nunca lanca', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    expect(() => funnelLog('payment_succeeded', { user: 'cm1', invoice: 'in_1' }, { persist: { adminAudit: { create } } })).not.toThrow();
    expect(create).toHaveBeenCalledWith({
      data: { action: 'funnel:payment_succeeded', targetUserId: 'cm1', details: { user: 'cm1', invoice: 'in_1' } },
    });
  });
});
