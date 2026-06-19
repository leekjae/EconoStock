CREATE TABLE public.screening_price_dates (
  trade_date TEXT PRIMARY KEY,
  row_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'screening_sqlite',
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

INSERT INTO public.screening_price_dates (trade_date, row_count, source)
SELECT
  trade_date,
  COUNT(*)::INTEGER AS row_count,
  'screening_sqlite' AS source
FROM public.screening_price_daily
GROUP BY trade_date
ON CONFLICT (trade_date) DO UPDATE
SET
  row_count = EXCLUDED.row_count,
  source = EXCLUDED.source,
  collected_at = now();

CREATE INDEX idx_screening_price_dates_trade_date
  ON public.screening_price_dates (trade_date DESC);

ALTER TABLE public.screening_price_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read screening price dates"
  ON public.screening_price_dates FOR SELECT
  USING (true);
