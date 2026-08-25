import { Fragment, ReactNode } from 'react';
import SiteLayout from '@/components/layout/SiteLayout';

export interface LegalSection {
  /** Vira o id da âncora e o item do índice lateral. */
  id: string;
  title: string;
  body: ReactNode;
}

interface LegalPageProps {
  eyebrow: string;
  title: string;
  intro: string;
  /** Data escrita à mão, ver o comentário abaixo. */
  updated: string;
  sections: LegalSection[];
  /** Fecho da página (foro, lei aplicável, contato). */
  footer?: ReactNode;
}

/**
 * Casca comum das páginas legais: /terms, /privacy, /cookies e /risk.
 *
 * Existe para que as quatro tenham a mesma estrutura: cabeçalho, data de
 * vigência, índice fixo à esquerda e o texto numa coluna de leitura. Antes
 * cada página legal desenhava a própria marcação e nenhuma delas tinha
 * cabeçalho, rodapé ou índice.
 *
 * A data de atualização é sempre uma CONSTANTE vinda da página, nunca
 * `new Date()`. Uma página que se declara atualizada hoje, todo dia, afirma
 * algo falso para quem lê: ao editar o texto, mude a data na mão.
 */
const LegalPage = ({ eyebrow, title, intro, updated, sections, footer }: LegalPageProps) => (
  <SiteLayout>
    <section className="site-dark site-phead">
      <div className="site-wrap">
        <span className="site-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{intro}</p>
        <span className="site-updated">Last updated {updated}</span>
      </div>
    </section>

    <section className="site-dark site-body-tight">
      <div className="site-wrap site-legal">
        <nav className="site-toc" aria-label="On this page">
          <h2>On this page</h2>
          <ul>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-prose">
          {sections.map((section) => (
            <Fragment key={section.id}>
              <h2 id={section.id}>{section.title}</h2>
              {section.body}
            </Fragment>
          ))}
          {footer ? <div className="site-callout">{footer}</div> : null}
        </div>
      </div>
    </section>
  </SiteLayout>
);

export default LegalPage;
