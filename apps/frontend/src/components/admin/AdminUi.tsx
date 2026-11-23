import type { ReactNode } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { buildApiUrl } from '@/lib/api';

/** GET autenticado numa rota `/api/admin/*`. `path` nulo = nao busca (ex.: busca ainda vazia). */
export function useAdminQuery<T>(path: string | null, staleTimeMs = 30_000) {
  const { getToken, isSignedIn } = useAuth();
  return useQuery<T, Error>({
    queryKey: ['admin', path],
    enabled: Boolean(isSignedIn) && path !== null,
    staleTime: staleTimeMs,
    retry: false,
    queryFn: async () => {
      const token = await getToken({ skipCache: true });
      const res = await fetch(buildApiUrl(`/api/admin/${path}`), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(res.status === 404 ? 'Nao encontrado.' : `Falha ao carregar (${res.status})`);
      return res.json();
    },
  });
}

/** Cartao com titulo; a unidade de layout das abas (grade de cartoes). */
export function Painel({ titulo, nota, children, className = '' }: { titulo?: string; nota?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`min-w-0 border-[var(--border-strong)] bg-[var(--fill-1)] p-4 ${className}`}>
      {titulo ? <h3 className="text-sm font-semibold text-[var(--text-primary)]">{titulo}</h3> : null}
      {nota ? <p className="mt-1 text-xs text-[var(--text-faint)]">{nota}</p> : null}
      <div className={titulo || nota ? 'mt-3' : ''}>{children}</div>
    </Card>
  );
}

/** Numero grande com legenda. */
export function Kpi({ valor, rotulo, nota }: { valor: ReactNode; rotulo: string; nota?: string }) {
  return (
    <Card className="min-w-0 border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
      <div className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{valor}</div>
      <div className="mt-0.5 text-xs text-[var(--text-dim)]">{rotulo}</div>
      {nota ? <div className="mt-1 text-[11px] text-[var(--text-faint)]">{nota}</div> : null}
    </Card>
  );
}

export type Tom = 'ok' | 'aviso' | 'ruim' | 'neutro';
const TOM: Record<Tom, string> = {
  ok: 'border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] text-[var(--signal-buy)]',
  aviso: 'border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] text-[var(--signal-hold)]',
  ruim: 'border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] text-[var(--signal-sell)]',
  neutro: 'border-[var(--border-strong)] bg-[var(--fill-2)] text-[var(--text-dim)]',
};

export function Chip({ tom = 'neutro', children }: { tom?: Tom; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${TOM[tom]}`}>{children}</span>;
}

/** Tabela que rola na horizontal no celular em vez de estourar a pagina. */
export function Tabela({ colunas, children }: { colunas: Array<{ rotulo: string; direita?: boolean }>; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] text-[var(--text-faint)]">
          <tr>
            {colunas.map((c) => (
              <th key={c.rotulo} className={`py-1 pr-3 font-normal ${c.direita ? 'text-right' : ''}`}>{c.rotulo}</th>
            ))}
          </tr>
        </thead>
        <tbody className="text-[var(--text-soft)]">{children}</tbody>
      </table>
    </div>
  );
}

export const Estado = ({ query }: { query: { isLoading: boolean; error: Error | null } }) =>
  query.isLoading ? (
    <p className="text-sm text-[var(--text-faint)]">Carregando...</p>
  ) : query.error ? (
    <p className="text-sm text-[var(--tone-down-2)]">{query.error.message}</p>
  ) : null;

// ── Formatacao ──────────────────────────────────────────────────────────────

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v.toFixed(0)}%`);
export const rFmt = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}R`);
export const usd = (v: number | null | undefined, casas = 4) => (v === null || v === undefined ? '-' : `US$ ${v.toFixed(casas).replace('.', ',')}`);
export const seg = (ms: number | null | undefined) => (ms === null || ms === undefined ? '-' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '-';

export const CLASSE_ATIVO: Record<string, string> = { metal: 'Metais', forex: 'Forex', crypto: 'Cripto', other: 'Outros' };
export const TIPO_ENTRADA: Record<string, string> = { now: 'Agora', pullback: 'Recuo', breakout: 'Rompimento', wait: 'Esperar' };
