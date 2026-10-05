/**
 * Aba "Origem" do /admin (05/10/2026): de onde vem quem cadastra, analisa e
 * assina.
 *
 * Duas fontes, lado a lado, porque respondem perguntas diferentes:
 * - DECLARADA: o que a pessoa marcou em "How did you find Tickrify?"
 *   (`User.acquisitionSource`, a primeira resposta vale). Pega o que a
 *   atribuicao tecnica nao ve: ChatGPT, indicacao, forum.
 * - TECNICA: primeiro toque gravado pelo navegador (`firstTouchAttribution`):
 *   `utmSource`, senao o dominio de onde veio.
 *
 * `assinaram` = criou assinatura na Stripe em qualquer estado (inclui cartao
 * recusado e cancelada); `ativos` = pagando hoje. A conversao da tela usa
 * `ativos`. Assinatura sempre SEM o acesso manual do dono (`stripeId NOT LIKE 'manual_%'`)
 * e sem contas admin, regra do CLAUDE.md. SQL cru e parametrizado, como o resto
 * do admin: o Prisma Client so e regenerado no Render.
 */
import { Prisma } from '@prisma/client';

export type ChannelRow = { canal: string; cadastros: number; analisaram: number; assinaram: number; ativos: number };
export type AnswerRow = {
  respondidoEm: Date;
  canal: string;
  detalhe: string | null;
  email: string | null;
  assinou: boolean;
};
export type AcquisitionReport = {
  dias: number | null;
  declarada: ChannelRow[];
  tecnica: ChannelRow[];
  respostas: AnswerRow[];
};

type RawQuerier = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };

/** `dias` aceitos na tela; qualquer outro valor vira 30. `0` = desde o inicio. */
export function parseDias(raw: unknown): number | null {
  const n = Number(raw);
  if (n === 0) return null;
  return [7, 30, 90].includes(n) ? n : 30;
}

const BASE = (dias: number | null) => Prisma.sql`
  WITH base AS (
    SELECT
      u."id",
      COALESCE(NULLIF(u."acquisitionSource", ''), '(sem resposta)') AS declarada,
      COALESCE(
        NULLIF(u."firstTouchAttribution"->>'utmSource', ''),
        NULLIF(u."firstTouchAttribution"->>'referrerDomain', ''),
        '(direto ou desconhecido)'
      ) AS tecnica,
      EXISTS (SELECT 1 FROM "tickrify"."Analysis" a WHERE a."userId" = u."id" AND a."status" = 'completed') AS analisou,
      EXISTS (SELECT 1 FROM "tickrify"."Subscription" s WHERE s."userId" = u."id" AND s."stripeId" NOT LIKE 'manual_%') AS assinou,
      EXISTS (
        SELECT 1 FROM "tickrify"."Subscription" s
        WHERE s."userId" = u."id" AND s."stripeId" NOT LIKE 'manual_%' AND s."status" IN ('active', 'trialing')
      ) AS ativo
    FROM "tickrify"."User" u
    WHERE COALESCE(u."role", 'user') <> 'admin'
    ${dias ? Prisma.sql`AND u."createdAt" >= NOW() - make_interval(days => ${dias}::int)` : Prisma.empty}
  )
`;

const porCanal = (dias: number | null, coluna: 'declarada' | 'tecnica') => Prisma.sql`
  ${BASE(dias)}
  SELECT ${Prisma.raw(coluna)} AS canal,
         COUNT(*)::int AS cadastros,
         COUNT(*) FILTER (WHERE analisou)::int AS analisaram,
         COUNT(*) FILTER (WHERE assinou)::int AS assinaram,
         COUNT(*) FILTER (WHERE ativo)::int AS ativos
  FROM base
  GROUP BY 1
  ORDER BY ativos DESC, assinaram DESC, cadastros DESC
  LIMIT 30
`;

export async function buildAcquisitionReport(prisma: RawQuerier, dias: number | null): Promise<AcquisitionReport> {
  const declarada = await prisma.$queryRaw<ChannelRow[]>(porCanal(dias, 'declarada'));
  const tecnica = await prisma.$queryRaw<ChannelRow[]>(porCanal(dias, 'tecnica'));
  const respostas = await prisma.$queryRaw<AnswerRow[]>(Prisma.sql`
    SELECT u."acquisitionAnsweredAt" AS "respondidoEm",
           u."acquisitionSource" AS canal,
           u."acquisitionDetail" AS detalhe,
           u."email" AS email,
           EXISTS (SELECT 1 FROM "tickrify"."Subscription" s WHERE s."userId" = u."id" AND s."stripeId" NOT LIKE 'manual_%') AS assinou
    FROM "tickrify"."User" u
    WHERE u."acquisitionSource" IS NOT NULL
      AND COALESCE(u."role", 'user') <> 'admin'
      ${dias ? Prisma.sql`AND u."acquisitionAnsweredAt" >= NOW() - make_interval(days => ${dias}::int)` : Prisma.empty}
    ORDER BY u."acquisitionAnsweredAt" DESC NULLS LAST
    LIMIT 50
  `);
  return { dias, declarada, tecnica, respostas };
}
