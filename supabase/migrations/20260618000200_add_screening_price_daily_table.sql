CREATE TABLE public.screening_price_daily (
  trade_date TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  open_price BIGINT NOT NULL DEFAULT 0,
  high_price BIGINT NOT NULL DEFAULT 0,
  low_price BIGINT NOT NULL DEFAULT 0,
  close_price BIGINT NOT NULL DEFAULT 0,
  volume BIGINT NOT NULL DEFAULT 0,
  value BIGINT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'screening_sqlite',
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_date, stock_code)
);

CREATE INDEX idx_screening_price_daily_date_market
  ON public.screening_price_daily (trade_date DESC, market);

CREATE INDEX idx_screening_price_daily_stock_date
  ON public.screening_price_daily (stock_code, trade_date DESC);

ALTER TABLE public.screening_price_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read screening price daily"
  ON public.screening_price_daily FOR SELECT
  USING (true);
