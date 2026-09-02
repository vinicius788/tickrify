import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/** Plataformas de onde o print pode vir. Só o nome, nunca o logo: não existe
 *  integração com nenhuma delas, e exibir a marca sugeriria parceria. */
const PLATFORMS = ['TradingView', 'MetaTrader 4 / 5', 'Binance', 'Bybit', 'Profit', 'Coinbase'];

/** Número que sobe ao entrar na tela. Uma vez só, e desliga em reduced-motion. */
const CountUp = ({ value, suffix = '' }: { value: number; suffix?: string }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }

    // Sem IntersectionObserver, o numero aparece direto. Nunca fica em 0.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(value);
      return;
    }

    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - start) / 1100, 1);
          setShown(Math.round(value * (1 - Math.pow(1 - p, 4))));
          if (p < 1) frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
      },
      // threshold 0, nao 0.4. Com 0.4 a faixa precisava estar 40% visivel para
      // o contador destravar: em viewport curta, ou com a faixa entrando so
      // pela borda, ela ficava parada exibindo "0 trades scored automatically"
      // e "0% setups the AI refuses to trade" — exatamente o contrario do que
      // esta secao existe para provar. Corrigido em 02/09/2026.
      { threshold: 0 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [value]);

  return <div ref={ref} className="site-stat-n">{shown}{suffix}</div>;
};

const SocialProof = () => {
  const { t } = useLanguage();
  const s = t.landing.social;

  // 104 = trades com desfecho já medido pelo sweeper (17/08/2026), mesma fonte
  // que alimenta a /accuracy. 39% = taxa de abstenção real em produção (155
  // WAIT em 395 análises). Nenhum número aqui é estimado.
  const stats = [
    { value: 104, suffix: '', label: s.s1label, sub: s.s1sub, href: '/accuracy' },
    { value: 39, suffix: '%', label: s.s4label, sub: s.s4sub },
    { value: 6, suffix: '+', label: s.s2label, sub: s.s2sub },
    { value: 3, suffix: '', label: s.s3label, sub: s.s3sub },
  ];

  return (
    <>
      <section className="site-dark site-strip">
        <div className="site-wrap">
          <div className="site-strip-grid">
            {stats.map((stat) => {
              const body = (
                <>
                  <CountUp value={stat.value} suffix={stat.suffix} />
                  <div className="site-stat-l">{stat.label}</div>
                  <div className="site-stat-s">{stat.sub}</div>
                </>
              );
              return stat.href ? (
                <Link key={stat.label} to={stat.href} className="site-stat">{body}</Link>
              ) : (
                <div key={stat.label} className="site-stat">{body}</div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="site-dark site-compat">
        <div className="site-wrap">
          <p className="site-compat-lab">{s.compat}</p>
          <div className="site-compat-row">
            {PLATFORMS.map((name) => <span key={name}>{name}</span>)}
          </div>
          <p className="site-compat-foot">
            All trademarks belong to their owners. Tickrify is not affiliated with, or endorsed by, any of them.
          </p>
        </div>
      </section>
    </>
  );
};

export default SocialProof;
