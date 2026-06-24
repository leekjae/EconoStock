import type { Tables } from "@/integrations/supabase/types";
import type {
  ScreeningPerformancePoint,
  ScreeningPerformanceRow,
} from "@/components/screening/useScreeningPerformance";

type ScreeningRun = Tables<"screening_runs">;

// Static screening archive (parity with investor-flow hot/archive split).
// Dates older than the hot cutoff are served from GitHub Pages JSON instead of Supabase.

export interface ScreeningArchiveFileMeta {
  month: string;
  path: string;
  trade_date_start: string;
  trade_date_end: string;
  run_count: number;
  candidate_count: number;
  signature: string;
}

export interface ScreeningArchiveManifest {
  version: number;
  mode: string;
  latest_trade_date: string;
  hot_cutoff_trade_date: string;
  hot_trade_days: number;
  archive_trade_days: number;
  archive_dates: string[];
  archive_files: ScreeningArchiveFileMeta[];
  generated_at: string;
}

export interface ScreeningArchiveRun {
  run_key: string;
  as_of_date: string;
  run_label: string;
  strategy_key: string;
  status: string;
  notes: string | null;
  candidate_count: number;
  average_score: number;
  max_score: number;
}

// [tradeDateCompact, open, high, low, close, closeReturnPct, highReturnPct, lowReturnPct]
export type ScreeningArchivePriceRow = [
  string,
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number | null,
];

export interface ScreeningArchiveCandidate {
  run_key: string;
  as_of_date: string;
  stock_code: string;
  stock_name: string;
  market: string;
  rank_no: number;
  score: number;
  signal: string;
  reason_summary: string | null;
  tags: string | null;
  entry_trade_date: string | null;
  entry_open_price: number | null;
  latest_trade_date: string | null;
  latest_close_price: number | null;
  highest_price: number | null;
  highest_trade_date: string | null;
  lowest_price: number | null;
  lowest_trade_date: string | null;
  return_pct: number | null;
  max_return_pct: number | null;
  max_drawdown_pct: number | null;
  price_series: ScreeningArchivePriceRow[];
}

export interface ScreeningArchiveMonthFile {
  version: number;
  month: string;
  dates: string[];
  runs: ScreeningArchiveRun[];
  candidates: ScreeningArchiveCandidate[];
}

const SCREENING_DATA_BASE =
  (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/") + "data/screening/";
const archiveJsonCache = new Map<string, Promise<unknown>>();

function getScreeningDataUrl(path: string) {
  return SCREENING_DATA_BASE + path.replace(/^\/+/, "");
}

async function fetchScreeningJson<T>(path: string): Promise<T> {
  const url = getScreeningDataUrl(path);
  const cached = archiveJsonCache.get(url);
  if (cached) return cached as Promise<T>;
  const pending = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("스크리닝 아카이브 파일을 불러오지 못했습니다. (" + response.status + ")");
      }
      return (await response.json()) as T;
    })
    .catch((error) => {
      archiveJsonCache.delete(url);
      throw error;
    });
  archiveJsonCache.set(url, pending);
  return pending as Promise<T>;
}

/** Returns the manifest, or null when no archive has been published yet. */
export async function fetchScreeningManifest(): Promise<ScreeningArchiveManifest | null> {
  try {
    return await fetchScreeningJson<ScreeningArchiveManifest>("manifest.json");
  } catch {
    return null;
  }
}

export async function fetchScreeningMonthFile(meta: ScreeningArchiveFileMeta) {
  return fetchScreeningJson<ScreeningArchiveMonthFile>(meta.path);
}

export function monthKeyFromCompact(compactDate: string) {
  if (!/^\d{8}$/.test(compactDate)) return "";
  return compactDate.slice(0, 4) + "-" + compactDate.slice(4, 6);
}

export function findMonthMetaForDate(
  manifest: ScreeningArchiveManifest,
  compactDate: string
): ScreeningArchiveFileMeta | null {
  const monthKey = monthKeyFromCompact(compactDate);
  return manifest.archive_files.find((file) => file.month === monthKey) ?? null;
}

export function isArchiveOnlyDate(
  manifest: ScreeningArchiveManifest | null | undefined,
  compactDate: string | null | undefined
) {
  if (!manifest || !compactDate) return false;
  return compactDate < manifest.hot_cutoff_trade_date;
}

function toScreeningRun(run: ScreeningArchiveRun): ScreeningRun {
  return {
    run_key: run.run_key,
    as_of_date: run.as_of_date,
    run_label: run.run_label,
    strategy_key: run.strategy_key,
    source: "archive",
    status: run.status,
    candidate_count: run.candidate_count,
    average_score: run.average_score,
    max_score: run.max_score,
    notes: run.notes,
    created_at: "",
  } as ScreeningRun;
}

function toPerformanceRow(candidate: ScreeningArchiveCandidate): ScreeningPerformanceRow {
  const priceSeries: ScreeningPerformancePoint[] = (candidate.price_series ?? []).map((row) => ({
    tradeDate: row[0],
    openPrice: row[1],
    highPrice: row[2],
    lowPrice: row[3],
    closePrice: row[4],
    closeReturnPct: row[5],
    highReturnPct: row[6],
    lowReturnPct: row[7],
  }));

  return {
    run_key: candidate.run_key,
    stock_code: candidate.stock_code,
    stock_name: candidate.stock_name,
    market: candidate.market,
    rank_no: candidate.rank_no,
    score: candidate.score,
    signal: candidate.signal,
    close_price: 0,
    change_rate: 0,
    volume: 0,
    reason_summary: candidate.reason_summary,
    tags: candidate.tags,
    created_at: "",
    entryTradeDate: candidate.entry_trade_date,
    entryOpenPrice: candidate.entry_open_price,
    latestTradeDate: candidate.latest_trade_date,
    latestClosePrice: candidate.latest_close_price,
    highestPrice: candidate.highest_price,
    highestTradeDate: candidate.highest_trade_date,
    lowestPrice: candidate.lowest_price,
    lowestTradeDate: candidate.lowest_trade_date,
    maxReturnPct: candidate.max_return_pct,
    maxDrawdownPct: candidate.max_drawdown_pct,
    returnPct: candidate.return_pct,
    priceSeries,
    performanceStatus: candidate.entry_open_price ? "ready" : "entry_missing",
  } as ScreeningPerformanceRow;
}

export function getArchiveRunsForDate(monthFile: ScreeningArchiveMonthFile, compactDate: string): ScreeningRun[] {
  return monthFile.runs.filter((run) => run.as_of_date === compactDate).map(toScreeningRun);
}

export function getArchiveRowsForDate(
  monthFile: ScreeningArchiveMonthFile,
  compactDate: string
): ScreeningPerformanceRow[] {
  return monthFile.candidates
    .filter((candidate) => candidate.as_of_date === compactDate)
    .map(toPerformanceRow);
}

export interface ArchivePerformanceSummary {
  monitoredCount: number;
  averageReturn: number;
  positiveCount: number;
  negativeCount: number;
  pendingCount: number;
  latestReferenceDate: string | null;
  bestReturn: number | null;
  worstDrawdown: number | null;
}

/** Mirror of useScreeningPerformance summary, computed over archived rows. */
export function buildArchiveSummary(rows: ScreeningPerformanceRow[]): ArchivePerformanceSummary {
  const ready = rows.filter((row) => row.returnPct !== null);
  const latestReferenceDate =
    ready
      .map((row) => row.latestTradeDate)
      .filter((date): date is string => Boolean(date))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;

  return {
    monitoredCount: ready.length,
    averageReturn:
      ready.length === 0 ? 0 : ready.reduce((sum, row) => sum + Number(row.returnPct || 0), 0) / ready.length,
    positiveCount: ready.filter((row) => (row.returnPct ?? 0) > 0).length,
    negativeCount: ready.filter((row) => (row.returnPct ?? 0) < 0).length,
    pendingCount: rows.length - ready.length,
    latestReferenceDate,
    bestReturn:
      ready.length === 0
        ? null
        : ready.reduce((max, row) => Math.max(max, Number(row.maxReturnPct ?? Number.NEGATIVE_INFINITY)), Number.NEGATIVE_INFINITY),
    worstDrawdown:
      ready.length === 0
        ? null
        : ready.reduce((min, row) => Math.min(min, Number(row.maxDrawdownPct ?? Number.POSITIVE_INFINITY)), Number.POSITIVE_INFINITY),
  };
}
