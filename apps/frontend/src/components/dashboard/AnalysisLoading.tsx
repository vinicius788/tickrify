import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface AnalysisLoadingProps {
  /** O gráfico que está sendo lido. Sem ele, só as fases aparecem. */
  chart?: string | null;
}

/**
 * Tela de espera da análise REAL, usada pelo dashboard e pela demo /try.
 *
 * Antes era uma lista de passos em caixas, com barra de progresso grossa: dizia
 * que algo acontecia sem mostrar nada acontecendo. Agora mostra o gráfico que a
 * IA está lendo, com a mesma varredura da demo da vitrine, e as fases embaixo.
 * A promessa da landing e o produto passam a ser a mesma coisa, que é o ponto:
 * quem viu a demo reconhece a tela.
 *
 * A varredura é decorativa e NÃO indica progresso real. O que é honesto está
 * escrito: a fase em curso e a estimativa de tempo. Uma barra que finge saber a
 * porcentagem de uma chamada de IA seria invenção.
 */
const AnalysisLoading = ({ chart = null }: AnalysisLoadingProps) => {
  const { t } = useLanguage();
  const steps = [t.loading.step1, t.loading.step2, t.loading.step3, t.loading.step4, t.loading.step5];
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setActive((prev) => Math.min(prev + 1, steps.length - 1)),
      5000,
    );
    return () => clearInterval(timer);
    // steps é recriado a cada render (vem do idioma); o timer só depende do tamanho.
  }, [steps.length]);

  return (
    <div className="tk-scanwrap">
      {chart ? (
        <div className="tk-scanbox">
          <img src={chart} alt="" />
          <span className="tk-scan" aria-hidden="true" />
        </div>
      ) : null}

      <div className="tk-scan-meta">
        <span>{t.loading.title}</span>
        <span>{t.loading.estimate}</span>
      </div>

      <div className="tk-phases" role="status" aria-live="polite">
        {steps.map((label, index) => (
          <div
            key={label}
            className={`tk-phase${index < active ? ' is-done' : ''}${index === active ? ' is-now' : ''}`}
          >
            <i aria-hidden="true" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AnalysisLoading;
