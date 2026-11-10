import { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildApiUrl } from '@/lib/api';
import { coletarContexto, lerAnaliseAtual } from '@/lib/breadcrumbs';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { OPEN_CHAT_EVENT, useChatThread } from '@/lib/support-chat';
import SupportChat from '@/components/SupportChat';

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
 *
 * 12/10/2026: a mesma bolha vira "Chat, feedback or problem", com o CHAT com o
 * fundador como aba padrao (problema e opiniao continuam iguais). O numero no
 * botao sao respostas do fundador ainda nao lidas.
 */
const ACTION_SELECTOR = 'a[href],button,input,select,textarea,[role="button"]';

/** A bolha esta em cima de algo clicavel? */
function coversAction(bubble: HTMLElement): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false;
  const { left, top, width, height } = bubble.getBoundingClientRect();
  // Dentro da forma arredondada e 6 px para os lados: a bolha nao encosta num botao.
  const xs = [left - 6, left + width * 0.2, left + width / 2, left + width * 0.8, left + width + 6];
  const points = xs.flatMap((x) => [0.25, 0.5, 0.75].map((fy) => [x, top + height * fy]));
  return points.some(([x, y]) =>
    document.elementsFromPoint(x, y).some((el) => !bubble.contains(el) && el.closest(ACTION_SELECTOR) !== null),
  );
}

export function ReportProblemButton({ analysisId: analysisIdProp }: { analysisId?: string } = {}) {
  const { getToken, isSignedIn } = useAuth();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
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
  // 05/10/2026: a mesma bolha recebe problema (contexto tecnico e e-mail ao
  // suporte) e opiniao (aba Opinioes do /admin, sem e-mail). 12/10/2026: o
  // chat com o fundador entra como padrao.
  const [modo, setModo] = useState<'chat' | 'problem' | 'feedback'>('chat');
  const opiniao = modo === 'feedback';
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const thread = useChatThread(Boolean(isSignedIn));
  const conversa = thread.data?.thread ?? null;
  const naoLidas = conversa?.unread ?? 0;

  const abrirChat = (surface: string) => {
    setModo('chat');
    setAberto(true);
    track('chat_opened', { surface, unread: naoLidas });
  };

  // A bolha nunca fica em cima de um botao: some enquanto houver um embaixo e
  // volta quando a pessoa rola. O contexto (menu do painel) continua abrindo o chat.
  const bolhaRef = useRef<HTMLButtonElement>(null);
  const [sobreAcao, setSobreAcao] = useState(false);
  useEffect(() => {
    if (!isSignedIn || aberto) return;
    let quadro = 0;
    const conferir = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        if (bolhaRef.current) setSobreAcao(coversAction(bolhaRef.current));
      });
    };
    conferir();
    window.addEventListener('scroll', conferir, { capture: true, passive: true });
    window.addEventListener('resize', conferir);
    const mudancas = new MutationObserver(conferir);
    mudancas.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('scroll', conferir, { capture: true });
      window.removeEventListener('resize', conferir);
      mudancas.disconnect();
    };
  }, [isSignedIn, aberto, pathname]);

  // Menu do painel e link do e-mail ("Vinicius replied") abrem direto no chat.
  useEffect(() => {
    const onOpen = (event: Event) => abrirChat(String((event as CustomEvent<{ surface?: string }>).detail?.surface || 'event'));
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  });
  useEffect(() => {
    if (!isSignedIn || !new URLSearchParams(search).has('chat')) return;
    abrirChat('email_link');
    const params = new URLSearchParams(search);
    params.delete('chat');
    navigate({ pathname, search: params.toString() ? `?${params}` : '' }, { replace: true });
    // So reage a URL nova (o link do e-mail), nao a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, search]);

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
    const rotulo = naoLidas > 0 ? `${r.bubble} (${t.chat.unread.replace('{n}', String(naoLidas))})` : r.bubble;
    return (
      <button
        ref={bolhaRef}
        type="button"
        onClick={() => abrirChat('bubble')}
        data-covering={sobreAcao ? 'true' : undefined}
        tabIndex={sobreAcao ? -1 : undefined}
        className={`fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-floating)] text-xs text-[var(--text-dim)] backdrop-blur transition-[opacity,color,border-color] hover:border-[var(--border-heavy)] hover:text-[var(--text-primary)] md:h-auto md:w-auto md:px-3.5 md:py-2 ${sobreAcao ? 'pointer-events-none opacity-0' : ''}`}
        aria-label={rotulo}
      >
        <MessageCircle className="h-5 w-5 md:hidden" aria-hidden />
        <span className="hidden md:inline">{r.bubble}</span>
        {naoLidas > 0 ? (
          <span key="unread" className="absolute -right-1 -top-1 min-w-[18px] rounded-full md:static bg-[var(--inverse-bg)] px-1.5 text-center text-[11px] font-semibold leading-[18px] text-[var(--inverse-fg)]">
            {String(naoLidas)}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex max-h-[min(640px,calc(100dvh-2rem))] w-[min(380px,calc(100vw-2rem))] flex-col rounded-xl border border-[var(--border-strong)] bg-[var(--bg-solid)] p-4 shadow-2xl">
      <div className="mb-3 flex shrink-0 items-start gap-2">
        <div className="flex flex-1 gap-1 rounded-lg bg-[var(--fill-2)] p-1" role="tablist">
          {(['chat', 'problem', 'feedback'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={modo === m}
              onClick={() => (m === 'chat' ? abrirChat('tab') : setModo(m))}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                modo === m ? 'bg-[var(--fill-5)] text-[var(--text-primary)]' : 'text-[var(--text-faint)] hover:text-[var(--text-soft)]'
              }`}
            >
              {m === 'chat' ? r.tabChat : m === 'problem' ? r.button : r.tabOpinion}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="px-1 py-1 text-[var(--text-faint)] hover:text-[var(--text-primary)]"
          aria-label={r.close}
        >
          ×
        </button>
      </div>

      {modo === 'chat' ? (
        <SupportChat key="chat" thread={conversa} />
      ) : (
      <div key="report">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{opiniao ? t.feedback.title : r.title}</h2>
      </div>

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={2000}
        rows={4}
        autoFocus
        placeholder={opiniao ? t.feedback.placeholder : r.placeholder}
        className="w-full resize-none rounded-lg border border-[var(--border-strong)] bg-[var(--bg-inset)] p-2.5 text-base text-[var(--text-primary)] placeholder:text-[var(--text-ghost)] focus:border-[var(--border-heavy)] focus:outline-none"
      />

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
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
      )}
    </div>
  );
}

export default ReportProblemButton;
