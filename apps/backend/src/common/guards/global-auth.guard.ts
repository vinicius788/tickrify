import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../../modules/auth/auth.guard';
import { PrismaService } from '../../modules/database/prisma.service';
import { MailService } from '../../modules/mail/mail.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * AuthGuard aplicado GLOBALMENTE (APP_GUARD), com escape explícito via @Public().
 *
 * Inverte o default de acesso do backend: antes, rota sem decorator era pública;
 * agora, rota sem decorator exige autenticação. A única forma de abrir uma rota
 * é marcá-la com @Public() — o que aparece no diff e é auditável por grep.
 *
 * Estende o AuthGuard em vez de substituí-lo de propósito: a lógica de verificar
 * o token do Clerk, ler o `role` DO BANCO (nunca do token) e promover admin pela
 * allowlist continua morando num lugar só, coberta pelos testes que já existem
 * (auth.guard.spec.ts e auth.guard.forged-token.spec.ts).
 *
 * Os `@UseGuards(AuthGuard)` que já existiam nos controllers foram MANTIDOS de
 * propósito (defesa em profundidade: se este registro global sumir num refactor,
 * as rotas continuam fechadas). O custo de rodar duas vezes é zero porque o
 * AuthGuard memoiza o resultado no próprio request — ver AuthGuard.canActivate.
 */
@Injectable()
export class GlobalAuthGuard extends AuthGuard {
  /* O `mail` não é usado aqui: ele existe só para ser repassado ao AuthGuard,
   * que passou a disparar o e-mail de boas-vindas no backfill. Herdar um guard
   * significa herdar as dependências dele, e esquecer de repassar uma quebra o
   * build inteiro (foi o que aconteceu: TS2554 em 14/09/2026). */
  constructor(
    prisma: PrismaService,
    mail: MailService,
    private readonly reflector: Reflector,
  ) {
    super(prisma, mail);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
