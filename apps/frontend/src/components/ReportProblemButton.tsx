import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useLocation } from 'react-router-dom';
import { buildApiUrl } from '@/lib/api';
import { coletarContexto, lerAnaliseAtual } from '@/lib/breadcrumbs';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';

/**
 * Botão de reportar problema.
 *
 * O QUE FAZ ELE VALER A PENA não é a caixa de texto, é o CONTEXTO que vai
 * junto sem o usuário precisar descrever nada. "Não funcionou" é irreprodutível;
 * "não funcionou" + rota + análise + as três últimas chamadas que falharam com
 * seus códigos de status é um bug que dá para caçar.
 *
 * O que NUNCA viaja: token, conteúdo de formulário, corpo de requisição. Só
 * ambiente e falhas. Ver lib/breadcrumbs.ts.
 *
 * Aparece só para quem está logado, porque o endpoint exige sessão.
 */
export function ReportProblemButton({ analysisId: analysisIdProp }: { analysisId?: string } = {}) {
  const { getToken, isSignedIn } = useAuth();
  const { pathname } = useLocation();
  const { toast } = useToast();
  // O botão é montado no app inteiro, inclusive nas páginas públicas, e o
  // texto estava fixo em português. Agora segue o idioma escolhido, como o
  // resto do produto (t.report).
  const { t } = useLanguage();
  const r = t.report;

  // Montado globalmente, o botão não recebe a análise por prop. Ela vem do
  // registro que a tela de resultado alimenta (lib/breadcrumbs). A prop
  // continua existindo para um uso pontual dentro de uma tela específica.
  const analysisId = analysisIdProp ?? lerAnaliseAtual();

  const [aberto, setAberto] = useState(false);
  // 05/10/2026: a mesma bolha recebe problema (padrao, igual a antes: contexto
  // tecnico e e-mail ao suporte) e opiniao (aba Opinioes do /admin, sem e-mail).
  const [modo, setModo] = useState<'problem' | 'feedback'>('problem');
  const opiniao = modo === 'feedback';
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (!isSignedIn) return null;

  const enviar = async () => {
    if (texto.trim().length < 5) {
      toast({ title: r.shortTitle, description: r.shortDesc });
      return;
    }

    setEnviando(true);
    try {
      const token = await getToken({ skipCache: true });
      const res = await fetch(buildApiUrl('/api/reports'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          opiniao
            ? { message: texto.trim(), route: pathname, kind: 'feedback' }
            : {
                message: texto.trim(),
                route: pathname,
                analysisId,
                context: coletarContexto(),
              },
        ),
      });

      if (res.status === 429) {
        // O limite é de 5 por hora. Dizer isso é melhor do que "erro 429":
        // quem está frustrado precisa saber que o primeiro relato chegou.
        toast({ title: r.rateTitle, description: r.rateDesc });
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);

      const { id } = await res.json();
      const tamanho = texto.trim().length;
      setTexto('');
      setAberto(false);
      if (opiniao) {
        track('feedback_sent', { length: tamanho, surface: 'bubble' });
        toast({ title: t.feedback.thanks });
        return;
      }
      toast({
        title: r.sentTitle,
        description: r.sentDesc.replace('{id}', String(id).slice(0, 8)),
      });
    } catch (erro) {
      toast({
        title: r.failTitle,
        description: erro instanceof Error ? `${r.failDesc} (${erro.message})` : r.failDesc,
        variant: 'destructive',
      });
    } finally {
      setEnviando(false);
    }
  };

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full border border-white/10 bg-black/70 px-3.5 py-2 text-xs text-zinc-400 backdrop-blur transition-colors hover:border-white/20 hover:text-white"
        aria-label={r.bubble}
      >
        {r.bubble}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#0b0b12] p-4 shadow-2xl">
      <div className="mb-3 flex gap-1 rounded-lg bg-white/5 p-1" role="tablist">
        {(['problem', 'feedback'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={modo === m}
            onClick={() => setModo(m)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
              modo === m ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {m === 'problem' ? r.button : r.tabOpinion}
          </button>
        ))}
      </div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">{opiniao ? t.feedback.title : r.title}</h2>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-zinc-500 hover:text-white"
          aria-label={r.close}
        >
          ×
        </button>
      </div>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={2000}
        rows={4}
        autoFocus
        placeholder={opiniao ? t.feedback.placeholder : r.placeholder}
        className="w-full resize-none rounded-lg border border-white/10 bg-black/40 p-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
      />

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        {opiniao ? t.feedback.subtitle : r.context.replace('{analysis}', analysisId ? r.contextAnalysis : '')}
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setAberto(false)} disabled={enviando}>
          {r.cancel}
        </Button>
        <Button size="sm" onClick={enviar} disabled={enviando}>
          {enviando ? r.sending : r.send}
        </Button>
      </div>
    </div>
  );
}

export default ReportProblemButton;
