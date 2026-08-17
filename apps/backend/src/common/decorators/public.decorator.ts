import { SetMetadata } from '@nestjs/common';

/**
 * Marca uma rota como PÚBLICA — o GlobalAuthGuard a deixa passar sem token.
 *
 * Por que isto existe (12/08/2026, auditoria de acesso):
 * Até aqui cada método declarava o próprio `@UseGuards(AuthGuard)`. O default
 * era FAIL-OPEN: método novo sem o decorator nascia público, sem erro de
 * compilação, sem teste falhando, e a revisão precisava reparar na AUSÊNCIA de
 * uma linha. Um `@Get('all-analyses')` esquecido vazava o banco inteiro e nada
 * avisava.
 *
 * Com o AuthGuard global, a omissão passou a FECHAR. Abrir uma rota virou ato
 * deliberado, gravável e auditável por `grep "@Public"`.
 *
 * REGRA: toda rota marcada aqui precisa de rate limit próprio (@Throttle) e de
 * um comentário dizendo por que é pública. Endpoint aberto que gasta API paga
 * (OpenAI) precisa também de anti-bot e de cota persistente — ver DemoService.
 */
export const IS_PUBLIC_KEY = 'tickrify:isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
