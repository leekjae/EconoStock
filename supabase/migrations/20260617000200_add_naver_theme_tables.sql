CREATE TABLE public.naver_themes (
  theme_no INTEGER PRIMARY KEY,
  theme_name TEXT NOT NULL,
  detail_url TEXT NOT NULL,
  stock_count INTEGER NOT NULL DEFAULT 0,
  page_no INTEGER NOT NULL DEFAULT 1,
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.naver_theme_stocks (
  theme_no INTEGER NOT NULL REFERENCES public.naver_themes (theme_no) ON DELETE CASCADE,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  rank_no INTEGER NOT NULL DEFAULT 0,
  scraped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (theme_no, stock_code)
);

CREATE TABLE public.naver_theme_sync_status (
  sync_key TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'naver',
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  theme_count INTEGER NOT NULL DEFAULT 0,
  stock_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_naver_themes_name ON public.naver_themes (theme_name);
CREATE INDEX idx_naver_theme_stocks_theme_no_rank ON public.naver_theme_stocks (theme_no, rank_no);
CREATE INDEX idx_naver_theme_stocks_stock_code ON public.naver_theme_stocks (stock_code);

ALTER TABLE public.naver_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.naver_theme_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.naver_theme_sync_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read naver themes"
  ON public.naver_themes FOR SELECT
  USING (true);

CREATE POLICY "Anyone can read naver theme stocks"
  ON public.naver_theme_stocks FOR SELECT
  USING (true);

CREATE POLICY "Anyone can read naver theme sync status"
  ON public.naver_theme_sync_status FOR SELECT
  USING (true);
