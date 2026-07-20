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
  const secretKey = String(process.env.CLERK_SECRET_KEY || '').trim();
  const id = String(clerkUserId || '').trim();
  if (!secretKey || !id) return null;

  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      primary_email_address_id?: string | null;
      email_addresses?: Array<{ id?: string; email_address?: string }>;
    };

    const list = Array.isArray(data.email_addresses) ? data.email_addresses : [];
    const primary = list.find((e) => e?.id && e.id === data.primary_email_address_id);
    const email = String(primary?.email_address || list[0]?.email_address || '').trim();
    return email || null;
  } catch {
    return null;
  }
}
