import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import chartLong from '@/assets/chart-long.svg';
import chartShort from '@/assets/chart-short.svg';
import chartWait from '@/assets/chart-wait.svg';

/**
 * Demonstração do painel: três leituras, duas que o motor aceita e uma que ele
 * recusa.
 *
 * O caso WAIT é o motivo desta seção existir. Todo concorrente mostra o acerto;
 * nenhum mostra a recusa. Os 39% de abstenção deixam de ser um número na faixa
 * de cima e viram uma cena.
 *
 * Os textos dos casos ficam em inglês de propósito: isto é a imitação de uma
 * TELA DO PRODUTO, e a interface do produto é em inglês. Está rotulado como
 * "Example" justamente para ser lido como print, não como promessa.
 *
 * Movimento: troca sozinha a cada 6,2s, para no hover e fora da tela, e no
 * prefers-reduced-motion vira estática. Nenhuma animação contínua.
 */
type Level = { label: string; value: string; delta?: string; tone?: 'long' | 'short' };

type Case = {
  sym: string;
  chart: string;
  side: string;
  arrow: string;
  tone: 'long' | 'short' | 'wait';
  conf: number;
  tier: string;
  levels?: Level[];
  changes?: string[];
  rationale: string;
  meta: string;
};

const CASES: Case[] = [
  {
    sym: 'XAUUSD · M30', chart: chartLong, side: 'LONG', arrow: '▲', tone: 'long', conf: 68, tier: 'Read',
    levels: [
      { label: 'Entry', value: '4,261.40' },
      { label: 'Stop', value: '4,240.00', delta: '-0.50%', tone: 'short' },
      { label: 'Target 1', value: '4,295.50', delta: '+0.80%', tone: 'long' },
      { label: 'Target 2', value: '4,320.00', delta: '+1.38%', tone: 'long' },
    ],
    rationale: 'Higher low confirmed after the sweep, and the demand zone held on the retest.',
    meta: 'R/R 1.6:1 · Confluence 4/8 · Bias BULLISH',
  },
  {
    sym: 'EURUSD · 15M', chart: chartShort, side: 'SHORT', arrow: '▼', tone: 'short', conf: 61, tier: 'Read',
    levels: [
      { label: 'Entry', value: '1.0842' },
      { label: 'Stop', value: '1.0861', delta: '+0.18%', tone: 'short' },
      { label: 'Target 1', value: '1.0808', delta: '-0.31%', tone: 'long' },
      { label: 'Target 2', value: '1.0784', delta: '-0.53%', tone: 'long' },
    ],
    rationale: 'Rally straight into prior supply with momentum fading and a change of character on the 5-minute.',
    meta: 'R/R 1.8:1 · Confluence 5/8 · Bias BEARISH',
  },
  {
    sym: 'BTCUSD · 1H', chart: chartWait, side: 'WAIT', arrow: '—', tone: 'wait', conf: 42, tier: 'No trade',
    changes: [
      'An hourly close above 64,180 with volume behind it.',
      'A clean rejection wick at 61,900.',
    ],
    rationale: 'Price is sitting mid-range with no displacement. Entering here pays the spread on noise.',
    meta: 'R/R n/a · Confluence 2/8 · Bias NEUTRAL',
  },
];

const HOLD = 6200;
const READ = 780;
const PHASES = ['Reading structure', 'Pulling live candles', 'Scoring risk'];

const PlatformDemoSection = () => {
  const { t } = useLanguage();
  const p = t.landing.preview;

  const [index, setIndex] = useState(0);
  const [reading, setReading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const go = useCallback((next: number) => {
    setIndex(next);
    if (reduced) return;
    setPhase(0);
    setReading(true);
  }, [reduced]);

  // Só roda enquanto a seção está na tela.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setRunning(Boolean(entry?.isIntersecting)),
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Troca automática.
  useEffect(() => {
    if (!running || paused || reduced) return;
    const bar = barRef.current;
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '0';
      void bar.offsetWidth;
      bar.style.transition = `width ${HOLD}ms linear`;
      bar.style.width = '100%';
    }
    const timer = window.setTimeout(() => go((index + 1) % CASES.length), HOLD);
    return () => window.clearTimeout(timer);
  }, [index, running, paused, reduced, go]);

  // Estado "lendo": varre o gráfico e troca a frase, depois entrega o veredito.
  useEffect(() => {
    if (!reading) return;
    const el = chartRef.current;
    if (el) el.style.setProperty('--scan-w', `${el.clientWidth}px`);
    const phaseTimers = PHASES.map((_, i) =>
      window.setTimeout(() => setPhase(i), (READ / PHASES.length) * i),
    );
    const done = window.setTimeout(() => setReading(false), READ);
    return () => {
      phaseTimers.forEach(window.clearTimeout);
      window.clearTimeout(done);
    };
  }, [reading, index]);

  const current = CASES[index];
  const toneClass = current.tone === 'long' ? 'site-long' : current.tone === 'short' ? 'site-short' : 'site-wait';

  return (
    <section id="platform" className="site-dark">
      <div className="site-wrap">
        <div className="site-shead">
          <div className="site-scol">
            <span className="site-eyebrow">{p.label}</span>
            <h2>{p.title} {p.highlight}</h2>
          </div>
          <p className="text-[0.96rem]">{p.subtitle}</p>
        </div>

        <div
          ref={rootRef}
          className="site-demo"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="site-demo-bar">
            <i /><i /><i />
            <span className="site-demo-url">tickrify.com/dashboard</span>
            <div className="site-demo-tabs" role="tablist">
              {CASES.map((item, i) => (
                <button
                  key={item.sym}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  className="site-demo-tab"
                  onClick={() => go(i)}
                >
                  {item.sym}
                </button>
              ))}
            </div>
          </div>

          <div className="site-demo-body">
            <div ref={chartRef} className={`site-demo-chart${reading ? ' is-reading' : ''}`}>
              <div className="site-demo-scan" />
              <img src={current.chart} alt="" />
            </div>

            <aside className="site-demo-side">
              <div className="site-card-head">
                <span className="site-sym">{current.sym}</span>
                <span className="site-chip">{t.landing.hero.mockLabel}</span>
              </div>

              <div className={`site-demo-state${reading ? ' is-out' : ''}`}>
                {reading ? (
                  <div className="site-demo-reading"><i />{PHASES[phase]}</div>
                ) : (
                  <>
                    <div className="site-verdict">
                      <span className={`site-call ${toneClass}`}>{current.arrow} {current.side}</span>
                      <span className="site-conf">Confidence <b>{current.conf}%</b> · tier <b>{current.tier}</b></span>
                    </div>

                    {current.levels ? (
                      <div className="site-levels">
                        {current.levels.map((level) => (
                          <div key={level.label}>
                            <span>{level.label}</span>
                            <strong className={level.tone === 'long' ? 'site-long' : level.tone === 'short' ? 'site-short' : ''}>
                              {level.value}
                              {level.delta ? <em>{level.delta}</em> : null}
                            </strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="site-demo-note">
                        <h4>What would change it</h4>
                        <ul>
                          {current.changes?.map((change) => <li key={change}>{change}</li>)}
                        </ul>
                      </div>
                    )}

                    <p className="site-demo-rationale">{current.rationale}</p>
                    <div className="site-demo-meta">{current.meta}</div>
                  </>
                )}
              </div>
            </aside>
          </div>

          <div className="site-demo-prog"><i ref={barRef} /></div>
        </div>
      </div>
    </section>
  );
};

export default PlatformDemoSection;
