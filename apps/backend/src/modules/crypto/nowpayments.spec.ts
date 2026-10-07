import { createHmac } from 'crypto';
import { nowPaymentsConfig, signIpn, sortDeep, verifyIpnSignature } from './nowpayments';

const SECRET = 'test-ipn-secret';
const BODY = {
  payment_status: 'finished',
  payment_id: 6249365965,
  order_id: 'ck_order_1',
  price_amount: 7.99,
  price_currency: 'usd',
  pay_currency: 'usdttrc20',
  actually_paid: 8.01,
  payment_extra_ids: [5513339153],
  fee: { currency: 'usdttrc20', depositFee: 0, withdrawalFee: 0, serviceFee: 0.08 },
};

/** O exemplo em Node da doc oficial, copiado como esta (lista vira objeto). */
function docExampleSign(params: any, key: string) {
  function sortObject(obj: any): any {
    return Object.keys(obj)
      .sort()
      .reduce((result: any, k) => {
        result[k] = obj[k] && typeof obj[k] === 'object' ? sortObject(obj[k]) : obj[k];
        return result;
      }, {});
  }
  return createHmac('sha512', key).update(JSON.stringify(sortObject(params))).digest('hex');
}

describe('assinatura do aviso do NOWPayments', () => {
  it('ordena as chaves em todos os niveis', () => {
    expect(JSON.stringify(sortDeep({ b: 1, a: { d: 1, c: 2 } }))).toBe('{"a":{"c":2,"d":1},"b":1}');
  });

  it('aceita a assinatura feita como no exemplo em Node da doc', () => {
    expect(verifyIpnSignature(BODY, docExampleSign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('aceita a assinatura com as listas preservadas (exemplo em PHP da doc)', () => {
    expect(verifyIpnSignature(BODY, signIpn(BODY, SECRET), SECRET)).toBe(true);
  });

  it('recusa corpo alterado, segredo errado, cabecalho ausente ou fora do formato', () => {
    const sig = signIpn(BODY, SECRET);
    expect(verifyIpnSignature({ ...BODY, price_amount: 0.01 }, sig, SECRET)).toBe(false);
    expect(verifyIpnSignature(BODY, signIpn(BODY, 'outro'), SECRET)).toBe(false);
    expect(verifyIpnSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyIpnSignature(BODY, 'abc', SECRET)).toBe(false);
    expect(verifyIpnSignature(BODY, sig, '')).toBe(false);
    expect(verifyIpnSignature([BODY], sig, SECRET)).toBe(false);
  });

  it('a API key nunca vai para host fora da lista', () => {
    const before = process.env.NOWPAYMENTS_API_URL;
    process.env.NOWPAYMENTS_API_URL = 'https://evil.example/v1';
    expect(nowPaymentsConfig().apiUrl).toBe('https://api.nowpayments.io/v1');
    process.env.NOWPAYMENTS_API_URL = 'https://api-sandbox.nowpayments.io/v1/';
    expect(nowPaymentsConfig().apiUrl).toBe('https://api-sandbox.nowpayments.io/v1');
    if (before === undefined) delete process.env.NOWPAYMENTS_API_URL;
    else process.env.NOWPAYMENTS_API_URL = before;
  });
});
