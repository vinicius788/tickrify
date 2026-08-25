import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * FAQ em <details> nativo: abre sem JavaScript, é acessível por teclado e o
 * buscador consegue ler a resposta mesmo fechada.
 */
const FaqSection = () => {
  const { t } = useLanguage();
  const fq = t.landing.faq;

  const items = [
    { q: fq.q1, a: fq.a1 },
    { q: fq.q2, a: fq.a2 },
    { q: fq.q3, a: fq.a3 },
    { q: fq.q4, a: fq.a4 },
    { q: fq.q5, a: fq.a5 },
    { q: fq.q6, a: fq.a6 },
  ];

  return (
    <section id="faq" className="site-dark">
      <div className="site-wrap site-faq">
        <div className="site-sblk">
          <span className="site-eyebrow">{fq.label}</span>
          <h2>{fq.title} {fq.highlight}</h2>
        </div>

        {items.map((item, index) => (
          <details key={item.q} open={index === 0}>
            <summary>
              {item.q}
              <i aria-hidden="true" />
            </summary>
            <p className="site-answer">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
};

export default FaqSection;
