
-- investor_snapshots: 투자자별 종목 매매 스냅샷
CREATE TABLE public.investor_snapshots (
  trade_date TEXT NOT NULL,
  market TEXT NOT NULL,
  investor_code TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL DEFAULT '',
  vol_sell BIGINT NOT NULL DEFAULT 0,
  vol_buy BIGINT NOT NULL DEFAULT 0,
  vol_net BIGINT NOT NULL DEFAULT 0,
  val_sell BIGINT NOT NULL DEFAULT 0,
  val_buy BIGINT NOT NULL DEFAULT 0,
  val_net BIGINT NOT NULL DEFAULT 0,
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_date, market, investor_code, stock_code)
);

-- Indexes for common queries
CREATE INDEX idx_investor_snapshots_date_market ON public.investor_snapshots (trade_date, market);
CREATE INDEX idx_investor_snapshots_date_investor ON public.investor_snapshots (trade_date, investor_code);

-- Enable RLS
ALTER TABLE public.investor_snapshots ENABLE ROW LEVEL SECURITY;

-- Public read, service_role write
CREATE POLICY "Anyone can read investor snapshots"
  ON public.investor_snapshots FOR SELECT
  USING (true);

-- investor_sync_status: 수집기 실행 상태
CREATE TABLE public.investor_sync_status (
  sync_key TEXT PRIMARY KEY,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  row_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.investor_sync_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read sync status"
  ON public.investor_sync_status FOR SELECT
  USING (true);
