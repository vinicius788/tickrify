import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const FaqSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const { t } = useLanguage();
  const fq = t.landing.faq;
  const [openItem, setOpenItem] = useState<string>('item-0');

  const faqs = [
    { question: fq.q1, answer: fq.a1 },
    { question: fq.q2, answer: fq.a2 },
    { question: fq.q3, answer: fq.a3 },
    { question: fq.q4, answer: fq.a4 },
    { question: fq.q5, answer: fq.a5 },
    { question: fq.q6, answer: fq.a6 },
  ];

  return (
    <section ref={revealRef} id="faq" className="landing-section section-primary reveal-on-scroll">
      <div className="container max-w-4xl">
        <SectionTitle label={fq.label} title={fq.title} highlight={fq.highlight} />

        <div>
          {faqs.map((faq, index) => {
            const value = `item-${index}`;
            const isOpen = openItem === value;

            return (
              <div key={value} className="faq-item-shell" data-state={isOpen ? 'open' : 'closed'}>
                <button
                  type="button"
                  className="faq-question-button"
                  onClick={() => setOpenItem(isOpen ? '' : value)}
                  aria-expanded={isOpen}
                >
                  <span>{faq.question}</span>
                  <span className="faq-icon-shell">
                    <Plus className="h-4 w-4" />
                  </span>
                </button>
                <div className="faq-answer-shell">
                  <p>{faq.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FaqSection;
