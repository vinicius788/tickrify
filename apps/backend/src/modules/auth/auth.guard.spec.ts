import { UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { AuthGuard } from './auth.guard';
import { MailService } from '../mail/mail.service';
import { fetchClerkProfile } from '../../common/utils/clerk-email';

jest.mock('../../common/utils/clerk-email', () => ({
  fetchClerkProfile: jest.fn().mockResolvedValue({ email: null, firstName: 'Ana' }),
}));

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

describe('AuthGuard', () => {
  const verifyTokenMock = verifyToken as jest.Mock;
  let guard: AuthGuard;
  let prisma: any;
  let mail: { sendWelcome: jest.Mock };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    delete process.env.BOOTSTRAP_ADMIN_EMAILS;

    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      adminAudit: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (callback) => callback(prisma)),
    };

    /* mockResolvedValue, nao jest.fn() seco: o guard faz
     * `void this.mail.sendWelcome(...).catch(...)`, entao um mock que devolve
     * undefined estoura com "Cannot read properties of undefined (reading
     * 'catch')" e derruba a autenticacao inteira no teste. */
    mail = {
      sendWelcome: jest.fn().mockResolvedValue(undefined),
      sendRecovery: jest.fn().mockResolvedValue(undefined),
      sendProblemReport: jest.fn().mockResolvedValue(undefined),
    } as unknown as typeof mail;

    guard = new AuthGuard(prisma, mail as unknown as MailService);
    verifyTokenMock.mockReset();
  });

  it('rejects requests without bearer token', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * A trava de seguranca central deste guard: `role` vem do BANCO, nunca do
   * token. O Clerk deixa o proprio usuario escrever em `unsafe_metadata`, entao
   * confiar no token seria deixar qualquer pessoa se promover a admin.
   *
   * O teste foi reescrito em 14/09/2026: ele ainda montava um mock de `upsert`,
   * e o guard tinha passado para find-then-create (para saber quem de fato criou
   * o usuario e disparar o e-mail de boas-vindas). O mock desatualizado fazia o
   * guard estourar com "prisma.user.findUnique is not a function", ou seja o
   * teste passou a falhar por motivo errado e nao cobria mais nada.
   */
  it('loads role from database even when token has admin metadata', async () => {
    verifyTokenMock.mockResolvedValue({
      sub: 'clerk_user_1',
      email: 'trader@tickrify.com',
      unsafe_metadata: { role: 'admin' },
      public_metadata: { role: 'admin' },
    });

    prisma.user.findUnique.mockResolvedValue({
      id: 'usr_1',
      clerkUserId: 'clerk_user_1',
      email: 'trader@tickrify.com',
      role: 'user',
    });

    const request: any = { headers: { authorization: 'Bearer fake.jwt.token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toEqual(
      expect.objectContaining({
        id: 'usr_1',
        clerkUserId: 'clerk_user_1',
        role: 'user',
      }),
    );
    // O admin do token nao pode vazar para o request em hipotese nenhuma.
    expect(request.user.role).not.toBe('admin');
  });

  it('creates a new user as role user, ignoring the role in the token', async () => {
    verifyTokenMock.mockResolvedValue({
      sub: 'clerk_user_2',
      email: 'novo@tickrify.com',
      public_metadata: { role: 'admin' },
    });

    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'usr_2',
      clerkUserId: 'clerk_user_2',
      email: 'novo@tickrify.com',
      role: 'user',
    });

    const request: any = { headers: { authorization: 'Bearer fake.jwt.token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'user' }),
      }),
    );
    expect(request.user.role).toBe('user');
  });

  it('envia boas-vindas uma vez para conta nova, com o primeiro nome', async () => {
    verifyTokenMock.mockResolvedValue({ sub: 'clerk_user_3', email: 'nova@tickrify.com' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'usr_3',
      clerkUserId: 'clerk_user_3',
      email: 'nova@tickrify.com',
      role: 'user',
    });
    const request: any = { headers: { authorization: 'Bearer fake.jwt.token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await guard.canActivate(context);
    // Segunda passada na mesma requisicao (GlobalAuthGuard + guard do controller): memoizada.
    await guard.canActivate(context);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mail.sendWelcome).toHaveBeenCalledTimes(1);
    expect(mail.sendWelcome).toHaveBeenCalledWith('nova@tickrify.com', 'Ana');
  });

  it('login comum de usuario existente nao envia boas-vindas', async () => {
    verifyTokenMock.mockResolvedValue({ sub: 'clerk_user_1', email: 'trader@tickrify.com' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'usr_1',
      clerkUserId: 'clerk_user_1',
      email: 'trader@tickrify.com',
      role: 'user',
    });
    const request: any = { headers: { authorization: 'Bearer fake.jwt.token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await guard.canActivate(context);
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(mail.sendWelcome).not.toHaveBeenCalled();
  });

  it('quem perde a corrida de criacao (P2002) nao recebe boas-vindas duplicada', async () => {
    verifyTokenMock.mockResolvedValue({ sub: 'clerk_user_4', email: 'corrida@tickrify.com' });
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'usr_4',
        clerkUserId: 'clerk_user_4',
        email: 'corrida@tickrify.com',
        role: 'user',
      });
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    const request: any = { headers: { authorization: 'Bearer fake.jwt.token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await guard.canActivate(context);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mail.sendWelcome).not.toHaveBeenCalled();
  });

  it('conta nova: a autenticacao conclui mesmo com o Clerk pendurado e a Resend falhando', async () => {
    verifyTokenMock.mockResolvedValue({ sub: 'clerk_user_5', email: 'lenta@tickrify.com' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'usr_5',
      clerkUserId: 'clerk_user_5',
      email: 'lenta@tickrify.com',
      role: 'user',
    });
    // Clerk que nunca responde: se o guard desse await nele, este teste estouraria o timeout.
    (fetchClerkProfile as jest.Mock).mockReturnValueOnce(new Promise(() => undefined));
    mail.sendWelcome.mockRejectedValue(new Error('resend fora do ar'));
    const request: any = { headers: { authorization: 'Bearer fake.jwt.token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.id).toBe('usr_5');
    expect(mail.sendWelcome).not.toHaveBeenCalled();
  });

  it('Resend falhando depois do Clerk nao gera erro nao tratado', async () => {
    verifyTokenMock.mockResolvedValue({ sub: 'clerk_user_6', email: 'falha@tickrify.com' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'usr_6',
      clerkUserId: 'clerk_user_6',
      email: 'falha@tickrify.com',
      role: 'user',
    });
    mail.sendWelcome.mockRejectedValue(new Error('resend fora do ar'));
    const request: any = { headers: { authorization: 'Bearer fake.jwt.token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mail.sendWelcome).toHaveBeenCalledTimes(1);
  });
});
