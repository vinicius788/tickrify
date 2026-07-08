import { attachRequestContext } from './request-context.middleware';

describe('request-context middleware', () => {
  it('reuses a valid incoming request id', () => {
    const req: any = {
      headers: {
        'x-request-id': 'abc12345-request',
      },
    };

    const setHeader = jest.fn();
    const res: any = { setHeader };
    const next = jest.fn();

    attachRequestContext(req, res, next);

    expect(req.requestId).toBe('abc12345-request');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'abc12345-request');
    expect(next).toHaveBeenCalled();
  });

  it('generates a request id when incoming one is invalid', () => {
    const req: any = {
      headers: {
        'x-request-id': 'bad id with spaces',
      },
    };

    const setHeader = jest.fn();
    const res: any = { setHeader };
    const next = jest.fn();

    attachRequestContext(req, res, next);

    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThanOrEqual(8);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
    expect(next).toHaveBeenCalled();
  });
});

