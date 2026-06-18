CREATE OR REPLACE FUNCTION public.get_investor_flow_ranked(
  p_start_date TEXT,
  p_end_date TEXT,
  p_market TEXT DEFAULT 'ALL',
  p_sort_by TEXT DEFAULT 'foreign',
  p_limit INTEGER DEFAULT 50,
  p_direction TEXT DEFAULT 'buy'
)
RETURNS TABLE (
  stock_code TEXT,
  stock_name TEXT,
  market TEXT,
  latest_trade_date TEXT,
  days_count INTEGER,
  latest_close_price BIGINT,
  individual_daily_net BIGINT,
  foreign_daily_net BIGINT,
  institution_daily_net BIGINT,
  individual_period_net BIGINT,
  foreign_period_net BIGINT,
  institution_period_net BIGINT,
  sort_period_value BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH params AS (
  SELECT
    LEAST(COALESCE(p_start_date, p_end_date), COALESCE(p_end_date, p_start_date)) AS range_start,
    GREATEST(COALESCE(p_start_date, p_end_date), COALESCE(p_end_date, p_start_date)) AS range_end,
    UPPER(COALESCE(p_market, 'ALL')) AS market_filter,
    LOWER(COALESCE(p_sort_by, 'foreign')) AS sort_filter,
    LOWER(COALESCE(p_direction, 'buy')) AS direction_filter,
    GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)) AS limit_filter
),
filtered AS (
  SELECT flow.*
  FROM public.investor_flow_daily AS flow
  CROSS JOIN params
  WHERE flow.trade_date >= params.range_start
    AND flow.trade_date <= params.range_end
    AND (params.market_filter = 'ALL' OR flow.market = params.market_filter)
),
scored AS (
  SELECT
    stock_code,
    MAX(stock_name) AS stock_name,
    MAX(market) AS market,
    MAX(trade_date) AS latest_trade_date,
    COUNT(*)::INTEGER AS days_count,
    COALESCE(MAX(close_price) FILTER (WHERE trade_date = (SELECT range_end FROM params)), MAX(close_price), 0)::BIGINT AS latest_close_price,
    COALESCE(SUM(individual_net) FILTER (WHERE trade_date = (SELECT range_end FROM params)), 0)::BIGINT AS individual_daily_net,
    COALESCE(SUM(foreign_net) FILTER (WHERE trade_date = (SELECT range_end FROM params)), 0)::BIGINT AS foreign_daily_net,
    COALESCE(SUM(institution_net) FILTER (WHERE trade_date = (SELECT range_end FROM params)), 0)::BIGINT AS institution_daily_net,
    COALESCE(SUM(individual_net), 0)::BIGINT AS individual_period_net,
    COALESCE(SUM(foreign_net), 0)::BIGINT AS foreign_period_net,
    COALESCE(SUM(institution_net), 0)::BIGINT AS institution_period_net
  FROM filtered
  GROUP BY stock_code
),
ranked AS (
  SELECT
    stock_code,
    stock_name,
    market,
    latest_trade_date,
    days_count,
    latest_close_price,
    individual_daily_net,
    foreign_daily_net,
    institution_daily_net,
    individual_period_net,
    foreign_period_net,
    institution_period_net,
    CASE
      WHEN (SELECT sort_filter FROM params) = 'individual' THEN individual_period_net
      WHEN (SELECT sort_filter FROM params) = 'institution' THEN institution_period_net
      ELSE foreign_period_net
    END::BIGINT AS sort_period_value
  FROM scored
),
filtered_ranked AS (
  SELECT *
  FROM ranked
  WHERE CASE
    WHEN (SELECT direction_filter FROM params) = 'sell' THEN sort_period_value < 0
    WHEN (SELECT direction_filter FROM params) = 'all' THEN sort_period_value <> 0
    ELSE sort_period_value > 0
  END
)
SELECT
  stock_code,
  stock_name,
  market,
  latest_trade_date,
  days_count,
  latest_close_price,
  individual_daily_net,
  foreign_daily_net,
  institution_daily_net,
  individual_period_net,
  foreign_period_net,
  institution_period_net,
  sort_period_value
FROM filtered_ranked
ORDER BY
  CASE WHEN (SELECT direction_filter FROM params) = 'sell' THEN sort_period_value END ASC NULLS LAST,
  CASE WHEN (SELECT direction_filter FROM params) <> 'sell' THEN sort_period_value END DESC NULLS LAST,
  stock_code ASC
LIMIT (SELECT limit_filter FROM params);
$$;

GRANT EXECUTE ON FUNCTION public.get_investor_flow_ranked(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) TO anon, authenticated;
