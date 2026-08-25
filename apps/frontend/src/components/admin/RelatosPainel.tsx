import { useState } from 'react';
import { useProblemReports, type ProblemReport, type ReportStatus } from '@/hooks/useProblemReports';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const FILTROS: Array<{ chave: ReportStatus | 'todos'; rotulo: string }> = [
  { chave: 'aberto', rotulo: 'abertos' },
  { chave: 'investigando', rotulo: 'investigando' },
  { chave: 'resolvido', rotulo: 'resolvidos' },
  { chave: 'descartado', rotulo: 'descartados' },
  { chave: 'todos', rotulo: 'todos' },
];

const COR_STATUS: Record<string, string> = {
  aberto: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  investigando: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  resolvido: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  descartado: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

function quando(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  return `há ${Math.round(horas / 24)}d`;
}

function Relato({
  relato,
  onStatus,
  ocupado,
}: {
  relato: ProblemReport;
  onStatus: (status: ReportStatus) => void;
  ocupado: boolean;
}) {
  const [contextoAberto, setContextoAberto] = useState(false);
  const ctx = (relato.context ?? {}) as Record<string, unknown>;
  const migalhas = Array.isArray(ctx.migalhas) ? (ctx.migalhas as string[]) : [];

  return (
    <Card className="border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-sm text-white">{relato.message}</p>
          <p className="mt-2 text-[11px] text-zinc-500">
            {quando(relato.createdAt)} · {relato.userEmail ?? 'sem e-mail'}
            {relato.route ? ` · ${relato.route}` : ''}
            {relato.analysisId ? ` · análise ${relato.analysisId.slice(0, 8)}` : ''}
          </p>
        </div>
        <Badge className={COR_STATUS[relato.status]}>{relato.status}</Badge>
      </div>

      {Object.keys(ctx).length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setContextoAberto((v) => !v)}
            className="mt-3 text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            {contextoAberto ? 'esconder' : 'ver'} o que o navegador registrou
            {migalhas.length > 0 ? ` (${migalhas.length} passos)` : ''}
          </button>

          {contextoAberto && (
            <div className="mt-2 space-y-2 rounded-lg border border-white/5 bg-black/40 p-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                {Object.entries(ctx)
                  .filter(([k]) => k !== 'migalhas')
                  .map(([chave, valor]) => (
                    <div key={chave} className="contents">
                      <dt className="text-zinc-600">{chave}</dt>
                      <dd className="truncate font-mono text-zinc-400">{String(valor)}</dd>
                    </div>
                  ))}
              </dl>

              {migalhas.length > 0 && (
                <div className="border-t border-white/5 pt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
                    últimos passos antes do relato
                  </p>
                  <ol className="space-y-0.5 font-mono text-[11px] text-zinc-400">
                    {migalhas.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(['investigando', 'resolvido', 'descartado'] as ReportStatus[])
          .filter((s) => s !== relato.status)
          .map((s) => (
            <Button key={s} size="sm" variant="ghost" disabled={ocupado} onClick={() => onStatus(s)}>
              marcar {s}
            </Button>
          ))}
      </div>
    </Card>
  );
}

export function RelatosPainel() {
  const [filtro, setFiltro] = useState<ReportStatus | 'todos'>('aberto');
  const { relatos, contagem, isLoading, setStatus } = useProblemReports(filtro);

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Relatos de problema</h2>
        <div className="flex flex-wrap gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              onClick={() => setFiltro(f.chave)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                filtro === f.chave ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {f.rotulo}
              {contagem[f.chave] ? ` (${contagem[f.chave]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-zinc-500">Carregando…</p>}

      {!isLoading && relatos.length === 0 && (
        <Card className="border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="text-sm text-zinc-400">
            Nenhum relato {filtro === 'todos' ? '' : filtro}.
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Silêncio aqui pode ser produto funcionando — ou ninguém usando. Cruze com o funil antes
            de comemorar.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {relatos.map((r) => (
          <Relato
            key={r.id}
            relato={r}
            ocupado={setStatus.isPending}
            onStatus={(status) => setStatus.mutate({ id: r.id, status })}
          />
        ))}
      </div>
    </section>
  );
}

export default RelatosPainel;
