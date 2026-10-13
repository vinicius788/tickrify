import { useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * A pergunta de atribuicao: "como voce encontrou a Tickrify?".
 *
 * POR QUE ISTO EXISTE (arquivo novo justificado)
 * Em 09/2026 chegaram os tres primeiros assinantes pagos e **nao foi possivel
 * dizer de onde vieram**. Nao por falta de ferramenta, mas porque as tres que
 * existem furam no mesmo lugar:
 *  - o PostHog so inicializa apos o aceite de cookies, entao quem recusa o
 *    banner e invisivel do primeiro clique ao pagamento;
 *  - `$initial_utm_source` e `$initial_referring_domain` vem VAZIOS neste
 *    projeto, ou seja nao existe primeiro toque, so o UTM do evento solto;
 *  - UTM morre no primeiro retorno direto, e quem pesquisa antes de comprar
 *    sempre volta pelo menos uma vez.
 * Uma pergunta de um clique nao tem nenhum desses furos: nao depende de
 * cookie, de parametro na URL nem de o visitante voltar pelo mesmo caminho.
 *
 * DECISOES QUE NAO SAO ARBITRARIAS
 * 1. Card no fluxo, nao modal. Bloquear o painel para cobrar uma resposta
 *    trocaria dado de atribuicao por atrito no produto, e o produto e que
 *    sustenta a assinatura.
 * 2. Um clique responde. Sem "enviar" obrigatorio, sem varios passos. A taxa
 *    de resposta cai com cada campo a mais, e aqui a amostra e minuscula.
 * 3. Lista fechada, um unico texto livre curto e opcional. Alem de facilitar
 *    a agregacao, mantem o campo aberto irrelevante como superficie de ataque.
 * 4. Dispensar nao grava nada. Resposta falsa e pior que ausencia de resposta,
 *    porque entra na contagem e ninguem desconfia.
 */

const OPCOES = [
  { id: 'chatgpt', chave: 'chatgpt' },
  { id: 'other_ai', chave: 'otherAi' },
  { id: 'google', chave: 'google' },
  { id: 'social', chave: 'social' },
  { id: 'community', chave: 'community' },
  { id: 'friend', chave: 'friend' },
  { id: 'ad', chave: 'ad' },
  { id: 'other', chave: 'other' },
] as const;

interface AcquisitionSurveyProps {
  /** Grava a resposta. Deve engolir o erro: isto nunca pode quebrar o painel. */
  onAnswer: (payload: { source: string; detail?: string }) => Promise<void>;
  /** Esconde o card nesta sessao, sem gravar nada. */
  onDismiss: () => void;
}

const AcquisitionSurvey = ({ onAnswer, onDismiss }: AcquisitionSurveyProps) => {
  const { t } = useLanguage();
  const u = t.acq;

  const [escolhaAberta, setEscolhaAberta] = useState(false);
  const [detalhe, setDetalhe] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [respondido, setRespondido] = useState(false);

  const responder = async (source: string, detail?: string) => {
    if (enviando) return;
    setEnviando(true);
    try {
      await onAnswer({ source, ...(detail ? { detail } : {}) });
    } finally {
      // Agradece mesmo se a gravacao falhar: a pessoa fez a parte dela, e um
      // erro de rede nosso nao e problema dela.
      setRespondido(true);
      setEnviando(false);
    }
  };

  if (respondido) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--fill-1)] px-4 py-3">
        <p className="text-sm text-[var(--text-secondary)]">{u.thanks}</p>
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border border-[var(--border-subtle)] bg-[var(--fill-1)] px-4 py-4">
      <button
        type="button"
        onClick={onDismiss}
        aria-label={u.dismiss}
        className="absolute right-3 top-3 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="pr-8 text-sm font-semibold text-[var(--text-primary)]">{u.title}</p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{u.subtitle}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {OPCOES.map((opcao) => (
          <button
            key={opcao.id}
            type="button"
            disabled={enviando}
            onClick={() => {
              if (opcao.id === 'other') {
                setEscolhaAberta(true);
                return;
              }
              void responder(opcao.id);
            }}
            className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--accent-green)] disabled:opacity-50"
          >
            {u[opcao.chave]}
          </button>
        ))}
      </div>

      {escolhaAberta && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            void responder('other', detalhe.trim().slice(0, 120));
          }}
        >
          <input
            type="text"
            value={detalhe}
            maxLength={120}
            autoFocus
            onChange={(evento) => setDetalhe(evento.target.value)}
            placeholder={u.otherPlaceholder}
            className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-green)]"
          />
          <button
            type="submit"
            disabled={enviando}
            className="rounded-lg border border-[var(--accent-green)] px-3 py-1.5 text-xs text-[var(--accent-green)] disabled:opacity-50"
          >
            {u.send}
          </button>
        </form>
      )}
    </div>
  );
};

export default AcquisitionSurvey;
