-- Diagnóstico agregado, somente leitura, com os mesmos filtros de /api/ai/accuracy.
-- Execute com credencial de leitura no PostgreSQL; nunca cole a URL nos relatórios.
-- A classificação replica as bases de market.service.ts em 23/09/2026.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';

WITH source_rows AS (
  SELECT
    "outcome",
    UPPER(REGEXP_REPLACE(
      COALESCE(
        NULLIF("result"->'analysis'->>'symbol', ''),
        NULLIF("result"->>'symbol', ''),
        ''
      ),
      '[^A-Za-z0-9]', '', 'g'
    )) AS symbol
  FROM tickrify."Analysis"
  WHERE "isDemo" = false
    AND "strategyHash" IS NULL
    AND "outcome" IN ('WIN', 'LOSS', 'NO_FILL', 'TIMEOUT', 'ABSTAIN', 'INCOMPLETE', 'UNTRACKABLE')
), classified AS (
  SELECT
    "outcome",
    CASE
      WHEN symbol = '' THEN 'sem_simbolo'
      WHEN symbol IN ('NAS100', 'US100', 'NDX', 'US30', 'DJI', 'US500', 'SPX', 'SPX500',
                      'DAX', 'GER40', 'UK100', 'FTSE', 'JP225', 'NKY', 'WIN', 'IBOV') THEN 'indices'
      WHEN symbol ~ '^(XAU|XAG)(USD|JPY|CHF|CAD|GBP|EUR|AUD|NZD)?$' THEN 'metais'
      WHEN REGEXP_REPLACE(symbol, '(USDT|USDC|BUSD|PERP|USD)$', '') IN (
        'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'MATIC',
        'DOT', 'LTC', 'TRX', 'SHIB', 'ATOM', 'UNI', 'APT', 'ARB', 'OP', 'SUI',
        'PEPE', 'NEAR', 'FIL', 'INJ', 'TIA', 'SEI', 'RNDR', 'BCH', 'ETC', 'XLM',
        'ICP', 'HBAR', 'IMX', 'AAVE', 'MKR', 'WIF', 'TON', 'FET', 'RUNE', 'ALGO'
      ) THEN 'cripto'
      WHEN symbol ~ '^(EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY)(USD|JPY|CHF|CAD|GBP|EUR|AUD|NZD)$' THEN 'forex'
      ELSE 'outros'
    END AS asset_class
  FROM source_rows
)
SELECT
  asset_class,
  COUNT(*)::integer AS total_outcomes,
  COUNT(*) FILTER (WHERE "outcome" = 'WIN')::integer AS wins,
  COUNT(*) FILTER (WHERE "outcome" = 'LOSS')::integer AS losses,
  COUNT(*) FILTER (WHERE "outcome" = 'NO_FILL')::integer AS no_fill,
  COUNT(*) FILTER (WHERE "outcome" = 'ABSTAIN')::integer AS abstain,
  COUNT(*) FILTER (WHERE "outcome" = 'UNTRACKABLE')::integer AS untrackable,
  COUNT(*) FILTER (WHERE "outcome" IN ('TIMEOUT', 'INCOMPLETE'))::integer AS other_outcomes
FROM classified
GROUP BY asset_class
ORDER BY total_outcomes DESC, asset_class;

COMMIT;
