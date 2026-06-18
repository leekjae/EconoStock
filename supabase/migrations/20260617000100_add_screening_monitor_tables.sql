CREATE TABLE public.screening_runs (
  run_key TEXT PRIMARY KEY,
  as_of_date TEXT NOT NULL,
  run_label TEXT NOT NULL DEFAULT '',
  strategy_key TEXT NOT NULL DEFAULT 'default',
  source TEXT NOT NULL DEFAULT 'csv',
  status TEXT NOT NULL DEFAULT 'completed',
  candidate_count INTEGER NOT NULL DEFAULT 0,
  average_score NUMERIC NOT NULL DEFAULT 0,
  max_score NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.screening_candidates (
  run_key TEXT NOT NULL REFERENCES public.screening_runs (run_key) ON DELETE CASCADE,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL DEFAULT '',
  market TEXT NOT NULL DEFAULT '',
  rank_no INTEGER NOT NULL DEFAULT 0,
  score NUMERIC NOT NULL DEFAULT 0,
  signal TEXT NOT NULL DEFAULT '',
  close_price NUMERIC NOT NULL DEFAULT 0,
  change_rate NUMERIC NOT NULL DEFAULT 0,
  volume BIGINT NOT NULL DEFAULT 0,
  reason_summary TEXT,
  tags TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (run_key, stock_code)
);

CREATE TABLE public.screening_sync_status (
  sync_key TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'manual',
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_screening_runs_as_of_date ON public.screening_runs (as_of_date DESC);
CREATE INDEX idx_screening_runs_strategy_key ON public.screening_runs (strategy_key, as_of_date DESC);
CREATE INDEX idx_screening_candidates_run_key ON public.screening_candidates (run_key, rank_no);
CREATE INDEX idx_screening_candidates_signal ON public.screening_candidates (signal);

ALTER TABLE public.screening_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_sync_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read screening runs"
  ON public.screening_runs FOR SELECT
  USING (true);

CREATE POLICY "Anyone can read screening candidates"
  ON public.screening_candidates FOR SELECT
  USING (true);

CREATE POLICY "Anyone can read screening sync status"
  ON public.screening_sync_status FOR SELECT
  USING (true);
