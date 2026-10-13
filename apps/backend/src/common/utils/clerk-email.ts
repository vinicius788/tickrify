import { Logger } from '@nestjs/common';

const logger = new Logger('ClerkEmail');

/**
 * Busca o e-mail primário de um usuário direto na API do Clerk.
 *
 * Por que existe: o session token do Clerk NÃO inclui o e-mail por padrão —
 * `extractEmailFromClaims` no AuthGuard sempre devolvia null, `User.email`
 * ficava NULL no banco e os e-mails (boas-vindas/recuperação) nunca saíam.
 *
 * Best-effort absoluto: timeout curto, nunca lança erro pra cima.
 * Sem dependência nova — usa o `fetch` global (Node 18+).
 */
export async function fetchClerkEmail(clerkUserId: string): Promise<string | null> {
  return (await fetchClerkProfile(clerkUserId)).email;
}

/**
 * Igual a fetchClerkEmail, mas devolve tambem o primeiro nome (boas-vindas) e
 * se o e-mail principal esta verificado no Clerk (trial: null = nao deu para
 * saber, e quem chama nao pune por isso).
 */
export async function fetchClerkProfile(
  clerkUserId: string,
): Promise<{ email: string | null; firstName: string | null; emailVerified: boolean | null }> {
  const none = { email: null, firstName: null, emailVerified: null };
  const secretKey = String(process.env.CLERK_SECRET_KEY || '').trim();
  const id = String(clerkUserId || '').trim();

  // ⚠️ ARMADILHA REAL (17/08/2026): o AuthGuard aceita CLERK_SECRET_KEY **ou**
  // CLERK_JWT_KEY. Esta função exige a SECRET_KEY especificamente (é chamada de
  // API, não verificação de token). Com só a JWT_KEY no ambiente, o login
  // funciona perfeitamente e TODO e-mail fica NULL — sem erro, sem log, sem
  // sintoma visível. Foi o estado encontrado: `email` NULL nas 20 contas mais
  // recentes, com login funcionando normalmente.
  if (!secretKey) {
    logger.error(
      '[email] CLERK_SECRET_KEY ausente — impossivel resolver e-mail. ' +
        'Boas-vindas e recuperacao NAO serao enviados. Setar no ambiente do Render.',
    );
    return none;
  }
  if (!id) return none;

  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      logger.warn(`[email] Clerk respondeu ${res.status} para ${id} — e-mail nao resolvido.`);
      return none;
    }

    const data = (await res.json()) as {
      primary_email_address_id?: string | null;
      email_addresses?: Array<{ id?: string; email_address?: string; verification?: { status?: string } | null }>;
      first_name?: string | null;
    };

    const list = Array.isArray(data.email_addresses) ? data.email_addresses : [];
    const primary = list.find((e) => e?.id && e.id === data.primary_email_address_id);
    const email = String(primary?.email_address || list[0]?.email_address || '').trim();
    if (!email) {
      logger.warn(`[email] Clerk nao devolveu endereco para ${id}.`);
      return none;
    }
    const firstName = String(data.first_name || '').trim() || null;
    const chosen = primary ?? list[0];
    const status = chosen?.verification?.status;
    const emailVerified = typeof status === 'string' ? status === 'verified' : null;
    return { email, firstName, emailVerified };
  } catch (err) {
    logger.warn(
      `[email] Falha ao consultar o Clerk para ${id}: ${err instanceof Error ? err.message : err}`,
    );
    return none;
  }
}
