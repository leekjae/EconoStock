CREATE TABLE public.investor_flow_daily (
  trade_date TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  close_price BIGINT NOT NULL DEFAULT 0,
  individual_net BIGINT NOT NULL DEFAULT 0,
  foreign_net BIGINT NOT NULL DEFAULT 0,
  institution_net BIGINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'screening_sqlite',
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_date, stock_code)
);

CREATE INDEX idx_investor_flow_daily_date_market
  ON public.investor_flow_daily (trade_date DESC, market);

CREATE INDEX idx_investor_flow_daily_stock_date
  ON public.investor_flow_daily (stock_code, trade_date DESC);

ALTER TABLE public.investor_flow_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read investor flow daily"
  ON public.investor_flow_daily FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.get_investor_flow_overview()
RETURNS TABLE (
  min_trade_date TEXT,
  max_trade_date TEXT,
  row_count BIGINT,
  stock_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    MIN(trade_date) AS min_trade_date,
    MAX(trade_date) AS max_trade_date,
    COUNT(*)::BIGINT AS row_count,
    COUNT(DISTINCT stock_code)::BIGINT AS stock_count
  FROM public.investor_flow_daily;
$$;

CREATE OR REPLACE FUNCTION public.get_investor_flow_trade_dates(p_limit INTEGER DEFAULT 120)
RETURNS TABLE (
  trade_date TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT dates.trade_date
  FROM (
    SELECT DISTINCT trade_date
    FROM public.investor_flow_daily
    ORDER BY trade_date DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 120), 4000))
  ) AS dates
  ORDER BY dates.trade_date DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_investor_flow_leaders(
  p_start_date TEXT,
  p_end_date TEXT,
  p_market TEXT DEFAULT 'ALL',
  p_investor_type TEXT DEFAULT 'foreign',
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
  daily_net_value BIGINT,
  period_net_value BIGINT,
  average_net_value NUMERIC
)
LANGUAGE sql
STABLE
AS $$
WITH params AS (
  SELECT
    UPPER(COALESCE(p_market, 'ALL')) AS market_filter,
    LOWER(COALESCE(p_investor_type, 'foreign')) AS investor_filter,
    LOWER(COALESCE(p_direction, 'buy')) AS direction_filter,
    GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)) AS limit_filter
),
filtered AS (
  SELECT flow.*
  FROM public.investor_flow_daily AS flow
  CROSS JOIN params
  WHERE flow.trade_date >= p_start_date
    AND flow.trade_date <= p_end_date
    AND (params.market_filter = 'ALL' OR flow.market = params.market_filter)
),
scored AS (
  SELECT
    stock_code,
    MAX(stock_name) AS stock_name,
    MAX(market) AS market,
    MAX(trade_date) AS latest_trade_date,
    COUNT(*)::INTEGER AS days_count,
    COALESCE(MAX(close_price) FILTER (WHERE trade_date = p_end_date), MAX(close_price), 0)::BIGINT AS latest_close_price,
    CASE
      WHEN (SELECT investor_filter FROM params) = 'individual'
        THEN COALESCE(SUM(individual_net) FILTER (WHERE trade_date = p_end_date), 0)
      WHEN (SELECT investor_filter FROM params) = 'institution'
        THEN COALESCE(SUM(institution_net) FILTER (WHERE trade_date = p_end_date), 0)
      ELSE COALESCE(SUM(foreign_net) FILTER (WHERE trade_date = p_end_date), 0)
    END::BIGINT AS daily_net_value,
    CASE
      WHEN (SELECT investor_filter FROM params) = 'individual'
        THEN COALESCE(SUM(individual_net), 0)
      WHEN (SELECT investor_filter FROM params) = 'institution'
        THEN COALESCE(SUM(institution_net), 0)
      ELSE COALESCE(SUM(foreign_net), 0)
    END::BIGINT AS period_net_value
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
    daily_net_value,
    period_net_value,
    ROUND(period_net_value::NUMERIC / NULLIF(days_count, 0), 2) AS average_net_value
  FROM scored
  WHERE CASE
    WHEN (SELECT direction_filter FROM params) = 'sell' THEN period_net_value < 0
    WHEN (SELECT direction_filter FROM params) = 'all' THEN period_net_value <> 0
    ELSE period_net_value > 0
  END
)
SELECT
  stock_code,
  stock_name,
  market,
  latest_trade_date,
  days_count,
  latest_close_price,
  daily_net_value,
  period_net_value,
  average_net_value
FROM ranked
ORDER BY
  CASE WHEN (SELECT direction_filter FROM params) = 'sell' THEN period_net_value END ASC NULLS LAST,
  CASE WHEN (SELECT direction_filter FROM params) <> 'sell' THEN period_net_value END DESC NULLS LAST,
  stock_code ASC
LIMIT (SELECT limit_filter FROM params);
$$;

GRANT EXECUTE ON FUNCTION public.get_investor_flow_overview() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_flow_trade_dates(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_investor_flow_leaders(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT) TO anon, authenticated;
