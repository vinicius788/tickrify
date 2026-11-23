import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { buildApiUrl } from '@/lib/api';

type Stats = {
  analyses: number;
  enterNowPct: number | null;
  watchPct: number | null;
  watchTracked: number;
  watchTouched: number;
  watchTouchedPct: number | null;
  closedTrades: number;
  win: number;
  loss: number;
  timeout: number;
  meanR: number | null;
};
type Report = {
  since: string;
  total: Stats;
  classes: { assetClass: string; stats: Stats }[];
  enterNow: { trades: number; meanR: number | null; verdict: string };
  noCandles: { reason: string; count: number }[];
  profiles?: { profile: 'conservative' | 'balanced' | 'aggressive'; stats: Stats; verdict: string }[];
};

const PERFIL: Record<string, string> = { conservative: 'Conservador', balanced: 'Equilibrado', aggressive: 'Arriscado' };

const CLASSE: Record<string, string> = { metal: 'Metais', forex: 'Forex', crypto: 'Cripto', other: 'Outros' };
const MOTIVO_SEM_VELAS: Record<string, string> = {
  symbol_timeout: 'Leitura do ativo passou do tempo',
  symbol_unreadable: 'Ativo ilegível no print',
  timeframe_unreadable: 'Tempo gráfico ilegível',
  timeout: 'Etapa de dados passou do tempo',
  error: 'Erro na etapa de dados',
  provider_quota: 'Cota do Twelve Data',
  source_unavailable: 'Fonte de velas fora do ar',
  provider_unconfigured: 'Fonte sem chave',
  unsupported_asset: 'Ativo sem fonte de velas',
  stale_withheld: 'Print antigo, velas retidas',
  not_recorded: 'Motivo não registrado',
};
const pct = (v: number | null) => (v === null ? '·' : `${v.toFixed(0)}%`);
const r = (v: number | null) => (v === null ? '·' : `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}R`);

function Linha({ rotulo, s, forte }: { rotulo: string; s: Stats; forte?: boolean }) {
  return (
    <tr className={`border-t border-[var(--border-subtle)] ${forte ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-soft)]'}`}>
      <td className="py-1.5 pr-3">{rotulo}</td>
      <td className="py-1.5 pr-3">{s.analyses}</td>
      <td className="py-1.5 pr-3">{pct(s.enterNowPct)}</td>
      <td className="py-1.5 pr-3">{pct(s.watchPct)}</td>
      <td className="py-1.5 pr-3">
        {pct(s.watchTouchedPct)} <span className="text-[var(--text-faint)]">({s.watchTouched}/{s.watchTracked})</span>
      </td>
      <td className="py-1.5 pr-3">{s.closedTrades}</td>
      <td className="py-1.5 pr-3">{s.win}/{s.loss}/{s.timeout}</td>
      <td className="py-1.5">{r(s.meanR)}</td>
    </tr>
  );
}

/** Aba "Motor": desempenho desde a correcao do fuso e a decisao ja aplicada. So leitura. Ver `GET admin/engine`. */
export default function MotorPainel() {
  const { getToken, isSignedIn } = useAuth();
  const query = useQuery<Report, Error>({
    queryKey: ['admin-engine'],
    enabled: Boolean(isSignedIn),
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const token = await getToken({ skipCache: true });
      const res = await fetch(buildApiUrl('/api/admin/engine'), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`Falha ao carregar (${res.status})`);
      return res.json();
    },
  });
  const data = query.data;

  return (
    <section className="mt-10 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Motor</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">
          Desde a correção do fuso (09/11/2026 14:09 UTC). WATCH tocado conta só janelas já fechadas. R por trade é líquido de spread.
        </p>
      </div>

      {query.isLoading ? <p className="text-sm text-[var(--text-faint)]">Carregando…</p> : null}
      {query.error ? <p className="text-sm text-[var(--tone-down-2)]">{query.error.message}</p> : null}

      {data ? (
        <>
          <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
            <p className="text-[11px] text-[var(--text-faint)]">R por trade do ENTER_NOW</p>
            <p className="mt-1 text-sm text-[var(--text-soft)]">
              {r(data.enterNow.meanR)} em {data.enterNow.trades} trades. {data.enterNow.verdict}
            </p>
          </Card>

          {data.profiles && data.profiles.length > 0 && (
            <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Perfis de risco</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] text-[var(--text-faint)]">
                    <tr>
                      <th className="py-1 pr-3">Perfil</th>
                      <th className="py-1 pr-3">Análises</th>
                      <th className="py-1 pr-3">ENTER_NOW</th>
                      <th className="py-1 pr-3">WATCH</th>
                      <th className="py-1 pr-3">WATCH tocado</th>
                      <th className="py-1 pr-3">Trades</th>
                      <th className="py-1 pr-3">W/L/T</th>
                      <th className="py-1">R por trade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.profiles.map((p) => (
                      <Linha key={p.profile} rotulo={PERFIL[p.profile] ?? p.profile} s={p.stats} />
                    ))}
                  </tbody>
                </table>
              </div>
              {data.profiles.map((p) => (
                <p key={p.profile} className="mt-1 text-sm text-[var(--text-soft)]">
                  {`${PERFIL[p.profile] ?? p.profile}: ${p.verdict}`}
                </p>
              ))}
            </Card>
          )}

          <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
            <p className="text-[11px] text-[var(--text-faint)]">Análises sem velas, por motivo</p>
            {data.noCandles.length === 0 ? (
              <p className="mt-1 text-sm text-[var(--text-soft)]">Nenhuma.</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm text-[var(--text-soft)]">
                {data.noCandles.map((item) => (
                  <li key={item.reason}>{`${MOTIVO_SEM_VELAS[item.reason] ?? item.reason}: ${item.count}`}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="border-[var(--border-strong)] bg-[var(--fill-1)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Por classe de ativo</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] text-[var(--text-faint)]">
                  <tr>
                    <th className="py-1 pr-3">Classe</th>
                    <th className="py-1 pr-3">Análises</th>
                    <th className="py-1 pr-3">ENTER_NOW</th>
                    <th className="py-1 pr-3">WATCH</th>
                    <th className="py-1 pr-3">WATCH tocado</th>
                    <th className="py-1 pr-3">Trades</th>
                    <th className="py-1 pr-3">W/L/T</th>
                    <th className="py-1">R por trade</th>
                  </tr>
                </thead>
                <tbody>
                  {data.classes.map((c) => (
                    <Linha key={c.assetClass} rotulo={CLASSE[c.assetClass] ?? c.assetClass} s={c.stats} />
                  ))}
                  <Linha rotulo="Total" s={data.total} forte />
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </section>
  );
}
