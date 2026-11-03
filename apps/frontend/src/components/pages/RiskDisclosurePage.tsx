import { Link } from 'react-router-dom';
import LegalPage, { type LegalSection } from '@/components/legal/LegalPage';
import { seoFor, useSeo } from '@/hooks/useSeo';

/**
 * Aviso de risco, /risk.
 *
 * Página nova de 24/08/2026. O rodapé já carregava o parágrafo de risco, mas
 * um parágrafo de rodapé não é um aviso: ninguém o lê e não dá para linkar.
 * Num produto que devolve COMPRA, VENDA e AGUARDA em cima do gráfico de
 * alguém, este é o documento que sustenta o resto do site.
 *
 * Regra desta página, a mesma de /accuracy: nada afirmado aqui pode ser mais
 * bonito do que a realidade medida. É por isso que ela manda o leitor para o
 * placar de acurácia em vez de prometer resultado.
 */
const LAST_UPDATED = 'November 3, 2026';

const SECTIONS: LegalSection[] = [
  {
    id: 'summary',
    title: 'The short version',
    body: (
      <>
        <p>
          Tickrify reads charts. It does not trade, it does not connect to your broker, and it does not know your
          account size, your other positions or your circumstances. Everything it produces is a second opinion on
          a chart you are already looking at.
        </p>
        <p>
          <strong>You can lose all of the money you put at risk.</strong> Leveraged products can lose more than
          you deposited. If you cannot afford that outcome, do not trade.
        </p>
      </>
    ),
  },
  {
    id: 'not-advice',
    title: 'This is not investment advice',
    body: (
      <>
        <p>
          Tickrify is not a broker, an investment adviser, a portfolio manager or a financial institution, and it
          is not licensed or supervised by any financial regulator. Nothing the platform produces is:
        </p>
        <ul>
          <li>personalised investment, financial, legal or tax advice;</li>
          <li>a recommendation to buy, sell or hold any instrument;</li>
          <li>an offer or a solicitation to enter into any transaction;</li>
          <li>a guarantee, forecast or promise of any result.</li>
        </ul>
        <p>
          Every entry, size, stop and exit is your decision, taken by you, at your own risk. Speak to a licensed
          professional in your own jurisdiction before acting.
        </p>
      </>
    ),
  },
  {
    id: 'markets',
    title: 'Market risk',
    body: (
      <>
        <p>
          Trading forex, crypto assets, equities, indices, commodities and derivatives carries a high level of
          risk and is not suitable for everyone. In particular:
        </p>
        <ul>
          <li>
            <strong>Leverage cuts both ways.</strong> A small move against a leveraged position can wipe out the
            capital behind it, and in some products can leave you owing more than you deposited.
          </li>
          <li>
            <strong>Volatility and gaps.</strong> Price can jump straight through a stop loss. A stop is an
            instruction, not a guarantee of the price you will get.
          </li>
          <li>
            <strong>Liquidity.</strong> In thin or fast markets you may not be able to close a position at, or
            anywhere near, the price you expect.
          </li>
          <li>
            <strong>Crypto assets</strong> trade continuously, are largely unregulated in most jurisdictions, and
            carry additional custody, exchange and counterparty risk.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'How the AI can be wrong',
    body: (
      <>
        <p>
          The analysis is produced by an artificial intelligence model reading an image of a chart, alongside
          live candle data where it is available (crypto, major forex pairs and metals; not stocks or indices).
          It is wrong regularly, and it can be wrong in ways that look convincing:
        </p>
        <ul>
          <li>it can misread the instrument, the timeframe or the scale of a screenshot;</li>
          <li>it can produce a confident, well argued analysis that the market immediately invalidates;</li>
          <li>it checks the economic calendar for scheduled high/medium-impact events (rate decisions, CPI, payrolls) in the window around the chart, best-effort, but it has no access to breaking news headlines or order flow, and no knowledge of anything that is not on the chart, in the data it is given, or on that calendar;</li>
          <li>sentiment data is used only for crypto (the Fear &amp; Greed index, funding rate, open interest and long/short ratio), and it describes the crowd, not where price will go;</li>
          <li>no part of the analysis is a probability we can promise you: a confidence score was measured, did not separate winning reads from losing ones, and is no longer shown.</li>
        </ul>
        <p>
          We publish the measured hit rate, the sample size and the confidence intervals, including the results
          that look bad, on the <Link to="/accuracy">accuracy page</Link>. Read it before you rely on anything the
          platform tells you.
        </p>
      </>
    ),
  },
  {
    id: 'past-results',
    title: 'Past results say nothing about future results',
    body: (
      <>
        <p>
          Every number Tickrify publishes about its own performance is historical, measured on a small sample, and
          drawn from the instruments our current users happen to chart. It is not a representative sample of all
          markets and it is not a forecast.
        </p>
        <p>
          Those figures also exclude trading costs. Spread, slippage, commission, financing and taxes are not
          deducted anywhere on this site. Your real outcome will be worse than the published rate.
        </p>
        <p>
          A hit rate is also not profitability: reward to risk, position size and your own discipline decide the
          result, and Tickrify has no visibility of any of them.
        </p>
      </>
    ),
  },
  {
    id: 'availability',
    title: 'Availability and accuracy of data',
    body: (
      <p>
        The platform depends on third party market data, AI providers and cloud infrastructure. It can be
        unavailable, delayed or incorrect without notice. Never place a trade whose outcome depends on Tickrify
        responding at a particular moment.
      </p>
    ),
  },
  {
    id: 'jurisdiction',
    title: 'Your jurisdiction',
    body: (
      <p>
        Access to this platform from territories where its content is unlawful is prohibited. It is your
        responsibility to know and comply with the rules that apply where you are. See section 14 of the{' '}
        <Link to="/terms">Terms of Service</Link> for restricted jurisdictions.
      </p>
    ),
  },
];

const RiskDisclosurePage = () => {
  useSeo(seoFor('/risk'));

  return (
    <LegalPage
      eyebrow="Legal"
      title="Risk disclosure"
      intro="Trading is how people lose money. Before you use anything on this site, this is what the tool is, what it is not, and what can go wrong."
      updated={LAST_UPDATED}
      sections={SECTIONS}
      footer={
        <>
          <h3>Acknowledgement</h3>
          <p>
            By using Tickrify you confirm that you have read this disclosure, that you understand the risks
            described, and that you accept sole responsibility for your trading decisions. Questions:{' '}
            <a href="mailto:support@tickrify.com">support@tickrify.com</a>
          </p>
        </>
      }
    />
  );
};

export default RiskDisclosurePage;
