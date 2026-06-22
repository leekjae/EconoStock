CREATE OR REPLACE FUNCTION public.get_investor_flow_daily_counts(
  p_start_date TEXT DEFAULT NULL,
  p_end_date TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 4000
)
RETURNS TABLE (
  trade_date TEXT,
  row_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    flow.trade_date,
    COUNT(*)::BIGINT AS row_count
  FROM public.investor_flow_daily AS flow
  WHERE (p_start_date IS NULL OR flow.trade_date >= REPLACE(p_start_date, '-', ''))
    AND (p_end_date IS NULL OR flow.trade_date <= REPLACE(p_end_date, '-', ''))
  GROUP BY flow.trade_date
  ORDER BY flow.trade_date DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 4000), 10000));
$$;

GRANT EXECUTE ON FUNCTION public.get_investor_flow_daily_counts(TEXT, TEXT, INTEGER) TO anon, authenticated;
