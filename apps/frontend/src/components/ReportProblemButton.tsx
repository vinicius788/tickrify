import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useLocation } from 'react-router-dom';
import { buildApiUrl } from '@/lib/api';
import { coletarContexto, lerAnaliseAtual } from '@/lib/breadcrumbs';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

/**
 * Botão de reportar problema.
 *
 * O QUE FAZ ELE VALER A PENA não é a caixa de texto — é o CONTEXTO que vai
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

  // Montado globalmente, o botão não recebe a análise por prop. Ela vem do
  // registro que a tela de resultado alimenta (lib/breadcrumbs). A prop
  // continua existindo para um uso pontual dentro de uma tela específica.
  const analysisId = analysisIdProp ?? lerAnaliseAtual();

  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (!isSignedIn) return null;

  const enviar = async () => {
    if (texto.trim().length < 5) {
      toast({ title: 'Conta um pouco mais', description: 'Cinco caracteres, no mínimo.' });
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
        body: JSON.stringify({
          message: texto.trim(),
          route: pathname,
          analysisId,
          context: coletarContexto(),
        }),
      });

      if (res.status === 429) {
        // O limite é de 5 por hora. Dizer isso é melhor do que "erro 429":
        // quem está frustrado precisa saber que o primeiro relato chegou.
        toast({
          title: 'Já recebemos seus relatos',
          description: 'Chegaram, sim. O limite é de 5 por hora para a lista continuar legível.',
        });
        return;
      }
      if (!res.ok) throw new Error(`Falhou (${res.status})`);

      const { id } = await res.json();
      setTexto('');
      setAberto(false);
      toast({
        title: 'Relato enviado',
        description: `Obrigado — isso ajuda de verdade. Protocolo ${String(id).slice(0, 8)}.`,
      });
    } catch (erro) {
      toast({
        title: 'Não deu para enviar',
        description: erro instanceof Error ? erro.message : 'Tente de novo em instantes.',
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
        aria-label="Reportar um problema"
      >
        Reportar problema
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#0b0b12] p-4 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">O que aconteceu?</h2>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-zinc-500 hover:text-white"
          aria-label="Fechar"
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
        placeholder="Ex: cliquei em analisar e a tela ficou girando pra sempre."
        className="w-full resize-none rounded-lg border border-white/10 bg-black/40 p-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
      />

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Vai junto automaticamente: a página em que você está
        {analysisId ? ', a análise aberta' : ''}, seu navegador e as últimas chamadas que
        falharam. Nada do que você digitou em outros campos é enviado.
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setAberto(false)} disabled={enviando}>
          cancelar
        </Button>
        <Button size="sm" onClick={enviar} disabled={enviando}>
          {enviando ? 'enviando…' : 'enviar'}
        </Button>
      </div>
    </div>
  );
}

export default ReportProblemButton;
