-- Somente medicoes novas. Wilson 95% entre WIN e LOSS; TIMEOUT entra no R medio.
WITH variants AS (
  SELECT "engineVersion", v.variant, v.trade
  FROM tickrify."AnalysisTrack"
  CROSS JOIN LATERAL (VALUES
    ('A', confirmation->'firstTouch'), ('B', confirmation)
  ) AS v(variant, trade)
  WHERE confirmation IS NOT NULL
), counts AS (
  SELECT "engineVersion", variant, count(trade->>'entryAt') AS entries,
         count(*) FILTER (WHERE trade->>'outcome' IN ('WIN','LOSS')) AS decided,
         count(*) FILTER (WHERE trade->>'outcome' = 'WIN') AS wins,
         avg((trade->>'rNet')::numeric) AS mean_net_r
  FROM variants GROUP BY "engineVersion", variant
), rates AS (
  SELECT *, wins::numeric / nullif(decided, 0) AS p, nullif(decided, 0)::numeric AS n
  FROM counts
), wilson AS (
  SELECT *, (p + 1.96^2 / (2*n)) / (1 + 1.96^2 / n) AS center,
         1.96 * sqrt(p*(1-p)/n + 1.96^2/(4*n*n)) / (1 + 1.96^2/n) AS half_width
  FROM rates
)
SELECT "engineVersion", variant, entries, wins, decided, p AS tp1_rate,
       CASE WHEN wins = 0 AND decided > 0 THEN 0 ELSE center - half_width END AS wilson_low,
       CASE WHEN wins = decided AND decided > 0 THEN 1 ELSE center + half_width END AS wilson_high,
       mean_net_r
FROM wilson ORDER BY "engineVersion", variant;
